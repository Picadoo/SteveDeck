const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const collectBlock = require('mineflayer-collectblock').plugin;
const logger = require('./utils/logger');
const { isFatalKick, extractText } = require('./utils/reconnectPolicy');
const { isChatBlocked } = require('./utils/chatSafety');
const waitForTeleport = require('./utils/waitForTeleport');
const { Recorder } = require('./modules/recorder');

// pnpm 下引擎不能直接 require 传递依赖；借 mineflayer 的解析路径拿到 minecraft-protocol（用其 ping 探测 Forge 模组表）。
let _mcp = null;
function getMcp() {
    if (_mcp !== null) return _mcp || null;
    try {
        const mfDir = path.dirname(require.resolve('mineflayer'));
        _mcp = require(require.resolve('minecraft-protocol', { paths: [mfDir] }));
    } catch (e) { _mcp = false; }
    return _mcp || null;
}

// ===== 可点击 / 可悬浮聊天解析 =====
// 把聊天 JSON 组件树展平成片段：每片段带文字 + 样式 + 可选 click(点→执行命令/开链接) / hover(悬浮→展示物品/文字)。
function flattenChatText(c) {
    if (c == null) return '';
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map(flattenChatText).join('');
    let s = c.text != null ? String(c.text) : '';
    if (Array.isArray(c.extra)) s += c.extra.map(flattenChatText).join('');
    return s;
}
function extractHoverText(h) {
    if (!h) return undefined;
    try {
        const action = h.action || '';
        const val = h.contents != null ? h.contents : h.value;
        if (action === 'show_item') {
            const s = (val && typeof val === 'object') ? (val.id || JSON.stringify(val)) : String(val || '');
            const m = s.match(/(?:minecraft:)?([a-z_]{3,})/i);
            return m ? `[物品] ${m[1]}` : '[物品]';
        }
        if (val == null) return undefined;
        const flat = (typeof val === 'string' ? val : flattenChatText(val)).replace(/§./gi, '').trim();
        return flat || undefined;
    } catch (e) { return undefined; }
}
function extractChatSegments(node, inherited, out) {
    if (node == null || out.length > 150) return;
    if (typeof node === 'string') { if (node) out.push({ text: node, ...inherited }); return; }
    const ce = node.clickEvent || node.click_event;
    const he = node.hoverEvent || node.hover_event;
    const style = {
        color: node.color || inherited.color,
        bold: node.bold != null ? !!node.bold : inherited.bold,
        italic: node.italic != null ? !!node.italic : inherited.italic,
        underlined: node.underlined != null ? !!node.underlined : inherited.underlined,
        strikethrough: node.strikethrough != null ? !!node.strikethrough : inherited.strikethrough,
        click: ce ? { action: String(ce.action || ''), value: String(ce.value != null ? ce.value : '') } : inherited.click,
        hover: extractHoverText(he) || inherited.hover,
    };
    const text = node.text != null ? String(node.text) : '';
    if (text) out.push({ text, ...style });
    if (Array.isArray(node.extra)) for (const c of node.extra) extractChatSegments(c, style, out);
}

class BotInstance {
    constructor(config, io, saveCallback, loadGlobalScripts) {
        this.config = config;
        this.io = io;
        this.bot = null;
        this.saveCallback = saveCallback;
        // 冷启动脚本预载用：全局脚本库加载器（由 botManager 注入）；缺省则回退旧路径
        this.loadGlobalScripts = typeof loadGlobalScripts === 'function' ? loadGlobalScripts : null;

        // ownerId 对应的 room 名，用于定向发送消息
        this._room = `user:${config.ownerId}`;

        // 1. 初始化默认配置：确保在模块加载前，这些对象已经存在防止空指针
        this.combatConfig = {
            enabled: false,
            range: 4.5,
            maxTargets: 2,
            antiKb: true,
            attackPlayers: false,
            attackMobs: true
        };
        this.fishingActive = false;

        // 保存的地点（最多5个）
        this.savedLocations = config.settings?.savedLocations || [];

        this.reconnectTimer = null;
        this.statusTimer = null;
        this.isExplicitlyQuitting = false;
        this.destroyed = false;        // stop()/deleteBot 后置位：init() 与延迟回调据此 bail，杜绝僵尸复活(CORE-1)
        this._epoch = 0;               // 连接世代：每次 init() +1，延迟回调比对防陈旧命中新会话(CORE-4)

        // 消息缓冲防止刷屏
        this.msgBuffer = "";
        this.msgTimeout = null;

        // 新增: 定时器和清理钩子管理
        this.timers = [];  // 存储所有定时器ID
        this.cleanupHooks = [];  // 存储模块清理函数

        // 新增: 重连管理
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = config.settings?.maxReconnectAttempts ?? 0; // 0 = 无限（7×24 挂机默认；fatal 仍兜底）
        this.reconnectBackoff = 1;
        this.stableTimer = null;       // 连接稳定计时器（min-uptime，稳定后才重置计数）
        this._fatalReason = null;      // 不可恢复的断开原因（命中则停止重连）
        this._lastStatusSig = null;    // 状态推送去重签名（静止挂机时避免每 2s 空推）
        this._lastStatusEmitAt = 0;

        // 录制：把玩家操作录成脚本步骤（一切皆步骤，与手搓/AI 同构）
        this.recorder = new Recorder(this);

        // 身体协调软锁：某模块用东西(吃/喝/右键)时占用，到期前其它循环让位一拍。零优先级(见 auto_use)。
        this.bodyBusy = 0;

        this.init();
    }

    // 一次性定时器：触发后自动从 timers 摘除句柄再执行回调。
    // 直接 timers.push(setTimeout(...)) 的句柄触发后仍留在数组里直至 cleanup——
    // 每次死亡/重连/切图都累积一条失效句柄，长跑无界增长（E7）。
    pushOneShot(fn, ms) {
        const h = setTimeout(() => {
            const i = this.timers.indexOf(h);
            if (i >= 0) this.timers.splice(i, 1);
            fn();
        }, ms);
        this.timers.push(h);
        return h;
    }

    // 身体协调：当前是否有动作占用身体（用东西时为 true）。
    isBodyBusy() { return Date.now() < (this.bodyBusy || 0); }
    // 占用身体 ms 毫秒（auto_use 执行一次「使用」时调用）。
    setBodyBusy(ms) { this.bodyBusy = Date.now() + (ms || 0); }

    // MODB-11：是否有客户端在「看」这个 bot——给周期性重活(背包NBT/计分板/监听推送)做门控，
    // 没人看就跳过这一拍，省掉 bot 多时永久全量空转的 CPU/GC。
    //
    // 本工程是「单主人广播模型」：botManager 注入的 io 是一个广播壳(只有 to()/emit()，to 为空操作，
    // emit 一律 io.emit 广播给所有已认证客户端)，因此「在看某个 bot」≡「有任意客户端连着」。
    // 判定策略（由强到弱，永远 fail-open，宁可多干活也不藏数据）：
    //   1) 能拿到「已连接客户端总数」(真实 IOServer 的 engine.clientsCount / namespace.sockets.size)：
    //      —— 仅当确定为 0(无人连)才返回 false 跳过；>0 即视为有人看。
    //   2) room 已被加入(将来若 botManager 改成真房间)：本 bot room 或 admin room 有 socket → 一定在看(只作「是」的加分，空房间绝不当「否」，避免误藏)。
    //   3) 三者都拿不到(当前广播壳)：返回 true(fail-open)——此时门控为安全空操作，待 io 暴露真实连接数后自动生效。
    hasWatchers() {
        try {
            const io = this.io;
            if (!io) return true;
            // 1) 已连接客户端总数（真实 IOServer 才有；广播壳没有 → 落到 fail-open）
            let clients = null;
            if (io.engine && typeof io.engine.clientsCount === 'number') clients = io.engine.clientsCount;
            else if (io.sockets && io.sockets.sockets && typeof io.sockets.sockets.size === 'number') clients = io.sockets.sockets.size;
            else if (typeof io.of === 'function') {
                const ns = io.of('/');
                if (ns && ns.sockets && typeof ns.sockets.size === 'number') clients = ns.sockets.size;
            }
            // 2) room 命中（仅作「确有人看」的加分；空 room 不当「无人」）
            const rooms = io.sockets && io.sockets.adapter && io.sockets.adapter.rooms;
            if (rooms && typeof rooms.get === 'function') {
                if ((rooms.get(this._room)?.size || 0) > 0) return true;
                if ((rooms.get('admin')?.size || 0) > 0) return true;
            }
            if (clients != null) return clients > 0; // 能确知连接数：0 才跳过
        } catch (e) { /* 探测失败 → fail-open */ }
        return true; // 拿不到任何可靠信号：保守继续下发
    }

    // 推一条 per-bot 日志到前端「日志」tab：连接生命周期/错误都走这里，
    // 避免用户连接时一片空白、不知道进没进服务器（用户明确反馈过的痛点）。
    uiLog(msg) {
        try {
            this.io.to(this._room).to('admin').emit('log', {
                user: this.config.username, ownerId: this.config.ownerId,
                msg, time: new Date().toLocaleTimeString()
            });
        } catch (e) { /* ignore */ }
    }

    // ===== 直接坐标包移动（模组服）=====
    // mineflayer 走路靠客户端物理模拟，需要"看懂"周围方块自己算；模组服（模组方块 / varint 丢的区块）算不动 → 走不了。
    // 这里改成像 MinecraftConsoleClient 那样：关掉物理，直接发 position 包告诉服务器"我到这了"，不依赖物理。
    // 仅 settings.rawMove 开启时生效（通用设置，不针对某个服）。
    get rawMoveEnabled() { return !!this.config?.settings?.rawMove; }

    setRawControl(states) {
        if (!this._raw) this._raw = { forward: false, back: false, left: false, right: false, sprint: false, sneak: false };
        for (const k of ['forward', 'back', 'left', 'right', 'sprint', 'sneak']) {
            if (k in states) this._raw[k] = !!states[k];
        }
        this._startRawLoop();
    }

    _startRawLoop() {
        if (this._rawTimer || !this.bot || !this.bot.entity) return;
        const bot = this.bot;
        // 诊断：开始移动时打印 bot 眼里的世界状态，确认到底是物理/区块问题还是别的
        try {
            const p = bot.entity.position;
            const below = bot.blockAt(p.offset(0, -1, 0));
            const yaw = bot.entity.yaw;
            const fwd = bot.blockAt(p.offset(-Math.sin(yaw), 0, Math.cos(yaw)));
            const m = `[诊断] 脚下=${below ? below.name : '未加载/空'} 前方=${fwd ? fwd.name : '未加载/空'} onGround=${bot.entity.onGround} physics=${bot.physicsEnabled}`;
            logger.info(`[${this.config.username}] ${m}`);
            this.uiLog(m);
        } catch (e) { /* ignore */ }
        try { bot.physicsEnabled = false; } catch (e) { /* ignore */ }
        this._rawTimer = setInterval(() => this._rawTick(), 100);
        this.timers.push(this._rawTimer);
        this.uiLog('已切换为直接移动（模组服）');
    }

    stopRawMove() {
        if (this._rawTimer) {
            clearInterval(this._rawTimer);
            // 从 timers 数组摘掉句柄，避免反复开关 rawMove 时数组无界增长（同 splice 模式）
            if (Array.isArray(this.timers)) {
                const i = this.timers.indexOf(this._rawTimer);
                if (i >= 0) this.timers.splice(i, 1);
            }
            this._rawTimer = null;
        }
        this._raw = null;
        try { if (this.bot) this.bot.physicsEnabled = true; } catch (e) { /* ignore */ }
    }

    _rawTick() {
        const bot = this.bot;
        if (!bot || !bot.entity) { return; }
        const c = this._raw || {};
        const yaw = bot.entity.yaw;
        const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
        let mx = 0, mz = 0;
        if (c.forward) { mx += -sinY; mz += cosY; }
        if (c.back) { mx += sinY; mz += -cosY; }
        if (c.left) { mx += cosY; mz += sinY; }
        if (c.right) { mx += -cosY; mz += -sinY; }
        const p = bot.entity.position;
        if (mx !== 0 || mz !== 0) {
            const len = Math.hypot(mx, mz) || 1;
            const speed = (c.sprint ? 5.4 : 4.3) * 0.1; // 每 100ms 步长（米）
            p.x += (mx / len) * speed;
            p.z += (mz / len) * speed;
            // Y 保持当前值（平地够用；复杂地形 v1 不处理高度）
        }
        try {
            bot._client.write('position', { x: p.x, y: p.y, z: p.z, onGround: true });
        } catch (e) { /* ignore */ }
    }

    // Forge 模组服：ping 一下服务器，从状态响应里拿到它的模组表（含正确 modid+version），
    // 用于 FML 握手时声明「我有这些模组」骗过校验。任何 Forge 服都能自动适配，无需手填。失败返回 null。
    pingForgeMods() {
        return new Promise((resolve) => {
            let done = false;
            const finish = (v) => { if (!done) { done = true; resolve(v); } };
            const mc = getMcp();
            if (!mc || typeof mc.ping !== 'function') return finish(null);
            try {
                mc.ping({ host: this.config.host, port: this.config.port || 25565, version: this.config.version || '1.12.2' }, (err, res) => {
                    if (err || !res) return finish(null);
                    let list = null;
                    if (res.modinfo && Array.isArray(res.modinfo.modList)) {
                        // 1.7–1.12 FML：modinfo.modList = [{modid, version}]
                        list = res.modinfo.modList.map((m) => ({ modid: m.modid, version: m.version }));
                    } else if (res.forgeData && Array.isArray(res.forgeData.mods)) {
                        // 1.13+ Forge：forgeData.mods = [{modId, modmarker}]
                        list = res.forgeData.mods.map((m) => ({ modid: m.modId || m.modid, version: m.modmarker || m.version || '' }));
                    }
                    finish(list && list.length ? list : null);
                });
                setTimeout(() => finish(null), 8000); // 超时兜底
            } catch (e) { finish(null); }
        });
    }

    async init() {
        this.cleanup();
        if (this.destroyed) return;    // 已被显式停止/删除：拒绝任何（含陈旧定时器触发的）复活(CORE-1)
        this.isExplicitlyQuitting = false;
        const epoch = ++this._epoch;   // 本次连接世代，供下方延迟回调（自动登录等）比对
        this.uiLog(`正在连接 ${this.config.host}:${this.config.port || 25565}（版本 ${!this.config.version || this.config.version === 'auto' ? '自动识别' : this.config.version}）…`);

        // Forge 模组服：首次连接前 ping 探测服务器模组表（正确 modid），缓存供 ModList 声明。
        // 任何 1.12.2 Forge 服开启「Forge 模式」即自动适配，无需手填模组。
        if (this.config.settings?.forge && this._forgeMods === undefined) {
            this.uiLog('Forge：正在探测服务器模组…');
            const detected = await this.pingForgeMods();
            if (this._epoch !== epoch || this.destroyed) return; // ping 期间被停止/重连 → 放弃本次
            this._forgeMods = (detected && detected.length) ? detected : (Array.isArray(this.config.settings?.forgeMods) ? this.config.settings.forgeMods : []);
            this.uiLog(`Forge：模组 ${this._forgeMods.length} 个（${detected ? '自动探测 ✓' : '配置/空'}）`);
        }

        try {
            const auth = this.config.auth || 'offline';
            // 版本 "auto"/未填：不传 version，mineflayer 连接前会先 ping 服务器自动识别协议版本
            const wantVersion = this.config.version && this.config.version !== 'auto' ? this.config.version : undefined;
            const botOpts = {
                host: this.config.host,
                port: this.config.port || 25565,
                username: this.config.username,
                auth,
                ...(wantVersion ? { version: wantVersion } : {}),
                // 省内存：只接收近处区块（区块数据是每个 bot 内存的大头）。可按 bot 配置覆盖：far/normal/short/tiny 或数字
                // lite 假人默认最小视距：区块缓存是单只 bot 内存的大头
                viewDistance: this.config.settings?.viewDistance || (this.config.settings?.lite ? 'tiny' : 'short'),
                hideErrors: true
            };
            if (auth === 'microsoft') {
                // 正版登录：令牌缓存进引擎数据目录（跟随 /data 卷迁移，重启免重新验证）；
                // 首次需设备码验证——把验证地址+代码推到 UI 日志，用户在任意浏览器完成即可。
                const { dataPath } = require('./config/paths');
                botOpts.profilesFolder = dataPath('msa-cache');
                botOpts.onMsaCode = (data) => {
                    const url = (data && (data.verification_uri || data.verificationUri)) || 'https://microsoft.com/link';
                    const code = (data && (data.user_code || data.userCode)) || '(未知)';
                    const msg = `🔑 微软正版验证：浏览器打开 ${url} 输入代码 ${code}（限时约15分钟，验证一次后引擎会记住）`;
                    logger.info(`[${this.config.username}] ${msg}`);
                    this.uiLog(msg);
                };
            }
            this.bot = mineflayer.createBot(botOpts);

            // Forge/FML 模组服（龙核 DragonCore 等）：在握手 serverHost 后附加 \0FML\0 标记，
            // 让服务器把我们当 Forge 客户端，否则登录阶段直接被 "requires FML/Forge" 踢。
            // 仅对开启 forge 的 bot 生效；并监听 FML|HS 握手消息（先诊断，看走到哪一步）。
            if (this.config.settings?.forge && this.bot._client) {
                const client = this.bot._client;
                client.tagHost = '\0FML\0';
                logger.info(`[${this.config.username}] 已启用 Forge 模式（FML 握手）`);
                this.uiLog('已启用 Forge 模式（FML 握手）');

                // FML1 握手状态机（1.7–1.12）。判别符为有符号字节：
                //   ServerHello=0 / ClientHello=1 / ModList=2 / RegistryData=3 / HandshakeAck=-1 / HandshakeReset=-2
                // Ack 的 phase：WAITINGSERVERDATA=2 / WAITINGSERVERCOMPLETE=3 / PENDINGCOMPLETE=4 / COMPLETE=5 / START=1
                const writeFML = (buf) => { try { client.write('custom_payload', { channel: 'FML|HS', data: buf }); } catch (e) { /* ignore */ } };
                const ack = (phase) => writeFML(Buffer.from([0xFF, phase]));
                // ModList：声明我们「拥有」服务器要求的模组（modid+version），骗过 Forge 的模组校验。
                const vInt = (n) => { const o = []; do { let b = n & 0x7f; n = n >>> 7; if (n) b |= 0x80; o.push(b); } while (n); return Buffer.from(o); };
                const vStr = (s) => { const b = Buffer.from(String(s), 'utf8'); return Buffer.concat([vInt(b.length), b]); };
                const buildModList = (mods) => { const parts = [Buffer.from([0x02]), vInt(mods.length)]; for (const m of mods) { parts.push(vStr(m.modid || m.id || '')); parts.push(vStr(m.version || '')); } return Buffer.concat(parts); };
                const forgeMods = Array.isArray(this._forgeMods) ? this._forgeMods : (Array.isArray(this.config.settings?.forgeMods) ? this.config.settings.forgeMods : []);
                let regTimer = null;
                client.on('custom_payload', (p) => {
                    if (!p || p.channel !== 'FML|HS' || !p.data || !p.data.length) return;
                    const disc = p.data.readInt8(0);
                    if (disc === 0) { // ServerHello → REGISTER + ClientHello + ModList(空) + Ack(2)
                        const fmlProto = p.data.length > 1 ? p.data[1] : 2;
                        try { client.write('custom_payload', { channel: 'REGISTER', data: Buffer.from(['FML|HS', 'FML', 'FML|MP', 'FORGE'].join('\0'), 'utf8') }); } catch (e) { /* ignore */ }
                        writeFML(Buffer.from([0x01, fmlProto])); // ClientHello
                        writeFML(buildModList(forgeMods));       // ModList：声明拥有配置里的模组（空数组=不声明）
                        ack(2);
                        this.uiLog(`[FML] ServerHello(proto=${fmlProto}) → ClientHello/ModList(${forgeMods.length}个)/Ack(2)`);
                    } else if (disc === 2) { // 服务器 ModList：解析出全部 modid（便于核对正确名字）
                        try {
                            let off = 1;
                            const rdV = () => { let v = 0, s = 0, b; do { b = p.data[off++]; v |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return v; };
                            const cnt = rdV(); const names = [];
                            for (let i = 0; i < cnt; i++) { const nl = rdV(); const nm = p.data.toString('utf8', off, off + nl); off += nl; const vl = rdV(); const ver = p.data.toString('utf8', off, off + vl); off += vl; names.push(`${nm}@${ver}`); }
                            logger.info(`[${this.config.username}] [FML] 服务器模组(${cnt}): ${names.join(', ')}`);
                            this.uiLog(`[FML] 服务器模组(${cnt}个)，详见引擎日志`);
                        } catch (e) { this.uiLog('[FML] 收到服务器 ModList（解析失败）'); }
                    } else if (disc === 3) { // RegistryData：可能多条，防抖后 Ack(3)
                        if (regTimer) clearTimeout(regTimer);
                        regTimer = setTimeout(() => { ack(3); this.uiLog('[FML] RegistryData 结束 → Ack(3)'); }, 700);
                    } else if (disc === -1) { // 服务器 HandshakeAck
                        const phase = p.data.length > 1 ? p.data.readInt8(1) : 0;
                        if (phase === 2) { ack(4); this.uiLog('[FML] 服务器Ack(2) → Ack(4)'); }
                        else if (phase === 3) { ack(5); this.uiLog('[FML] 握手完成 → Ack(5) ✅'); }
                    } else if (disc === -2) { // HandshakeReset
                        ack(1);
                    }
                });
            }

            // 加载核心插件（lite 假人不加载：寻路插件每物理 tick 都有监听开销，假人用不上）
            if (!this.config.settings?.lite) {
                this.bot.loadPlugin(pathfinder);
                this.bot.loadPlugin(collectBlock);
            }

            // 关键：捕获 bot._client 的错误，防止崩溃
            if (this.bot._client) {
                this.bot._client.on('error', (err) => {
                    logger.error(`[${this.config.username}] 客户端错误:`, err.message);
                    // 不抛出，让 'end' 事件处理重连
                });
            }

            this.bot.once('spawn', () => {
              try {
                this.spawnedAt = Date.now(); // 本次在线起点（用于在线时长显示）
                // 不立即清零：稳定在线 30 秒才认为连接健康，避免"登录即被踢"的抖动循环绕过重试上限
                if (this.stableTimer) clearTimeout(this.stableTimer);
                this.stableTimer = setTimeout(() => {
                    this.reconnectAttempts = 0;
                    this.reconnectBackoff = 1;
                    logger.info(`[${this.config.username}] 连接稳定，已重置重连计数`);
                }, 30000);

                logger.info(`[${this.config.username}] 登录成功，正在挂载功能模块...`);
                this.uiLog('✅ 已进入服务器');

                // 2. 模块挂载：逐个 try/catch 隔离——单个模块构造抛错不再连累后续模块与状态推送
                // lite 假人（氛围组）只挂防挂机踢：不挂任何功能模块，单只内存/CPU 压到最低
                const MODULE_NAMES = this.config.settings?.lite ? ['anti_afk'] : [
                    'combat', 'fishing', 'scheduler', 'player_inventory',
                    'interact', 'automine', 'trash_cleaner', 'auto_farm', 'mob_hunter',
                    'follow', 'scoreboard', 'script_engine', 'window_gui',
                    'custom_js', 'bot_viewer', 'message_monitor', 'auto_use',
                ];
                for (const name of MODULE_NAMES) {
                    try {
                        require(`./modules/${name}`)(this);
                    } catch (err) {
                        logger.error(`[${this.config.username}] 模块[${name}]挂载失败:`, err?.message || err);
                    }
                }

                // 3. 配置恢复：统一恢复各模块上次的激活状态（含自动挖矿断线续挖）
                try {
                    this.restoreModules(this.config.settings || {});
                } catch (err) {
                    logger.error(`[${this.config.username}] 模块状态恢复失败:`, err?.message || err);
                }

                // 4. 自动注册/登录：配置了密码则延迟2秒发送。
                // - 首次进服且配了 registerCommand（AuthMe 类登录服）→ 发注册指令并持久化 registered，
                //   本次会话不再发登录（注册成功通常自动登录；若服上已有此名，注册报错无害，下次会话走登录）
                // - 其余情况发 loginCommand。两种模板都支持 {password}/{username} 占位，
                //   模板没写 {password} 时把密码追加在末尾；登录默认 "/login {password}"。
                // 适配 /l、/login、AuthMe 等各种离线服登录指令；正版(microsoft)服一般不设密码，自然跳过。
                if (this.config.password) {
                    this.pushOneShot(() => {
                        try {
                            if (this.bot && this._epoch === epoch) {
                                const s = this.config.settings || {};
                                const firstAuth = !!(s.registerCommand && !s.registered);
                                const tpl = firstAuth
                                    ? String(s.registerCommand)
                                    : String(this.config.loginCommand || '/login {password}');
                                let cmd = tpl
                                    .replace(/\{username\}/g, this.config.username)
                                    .replace(/\{password\}/g, this.config.password);
                                if (!tpl.includes('{password}')) cmd = `${cmd} ${this.config.password}`;
                                this.bot.chat(cmd);
                                if (firstAuth) {
                                    s.registered = true;
                                    this.config.settings = s;
                                    if (typeof this.saveConfig === 'function') this.saveConfig();
                                }
                                logger.info(`[${this.config.username}] 已自动发送${firstAuth ? '注册' : '登录'}命令（模板: ${tpl}）`);
                            }
                        } catch (err) {
                            logger.error(`[${this.config.username}] 自动登录失败:`, err?.message || err);
                        }
                    }, 2000); // 延迟2秒，给服务器加载时间（句柄入 timers，断线即取消）
                }

                // 应用寻路策略（默认无破坏模式，适配受保护地图）
                this.applyMovements();
              } catch (err) {
                logger.error(`[${this.config.username}] spawn 处理异常:`, err?.message || err);
              } finally {
                // 状态同步必须启动（即便上面出错），否则前端会一直显示离线
                if (this.statusTimer) clearInterval(this.statusTimer);
                this.statusTimer = setInterval(() => this.updateStatus(), 2000);
              }
            });

            this.setupEvents();
        } catch (err) {
            logger.error(`[${this.config.username}] 初始化失败:`, err.message);
            this.handleReconnect();
        }
    }

    // 统一恢复各模块的激活状态（重连后自动续上：战斗/钓鱼/农场/追怪/挖矿/脚本）。
    // 单处集中，新增模块只需在此加一行，不再散落于 spawn 回调。
    restoreModules(settings) {
        settings = settings || this.config.settings || {};

        // 立即恢复（仅纯配置/脚本库，不会移动 bot，登录前执行无副作用）
        try {
            if (settings.combatConfig) this.combatConfig = { ...this.combatConfig, ...settings.combatConfig };
            // 脚本库：冷启动优先从全局 scripts.json 预载；settings.scripts 仅作回退。
            let scriptsToLoad = {};
            try { if (this.loadGlobalScripts) scriptsToLoad = this.loadGlobalScripts() || {}; } catch (e) { /* 回退 */ }
            if (!scriptsToLoad || Object.keys(scriptsToLoad).length === 0) {
                scriptsToLoad = settings.scripts || {};
            }
            if (this.preloadScripts && scriptsToLoad && typeof scriptsToLoad === 'object') {
                this.preloadScripts(scriptsToLoad);
                logger.info(`[${this.config.username}] 已恢复 ${Object.keys(scriptsToLoad).length} 个脚本`);
            }
        } catch (err) {
            logger.error(`[${this.config.username}] 配置/脚本预载失败:`, err.message);
        }

        // 延迟激活会移动 bot 的模块：必须晚于自动 /login（2秒），否则在需要登录的服务器上动作会被冻结/拒绝
        const RESTORE_DELAY = 3500;
        const epoch = this._epoch; // 捕获当前世代：延迟期间若断线重连(新世代)则不对新连接重复激活(CORE-4)
        this.pushOneShot(() => {
            if (this._epoch !== epoch || !this.bot || !this.bot.entity) return; // 已断线/换连接则放弃
            try {
                this.combatConfig.enabled = settings.combat || false;
                if (settings.fishing) { if (typeof this.setFishing === 'function') this.setFishing(true); else this.fishingActive = true; }
                if (settings.autoFarm && this.toggleAutoFarm) this.toggleAutoFarm(true, settings.autoFarm);
                if (settings.mobHunter && this.toggleMobHunter) {
                    const active = settings.mobHunter.active !== undefined ? !!settings.mobHunter.active : true;
                    const cfg = settings.mobHunter.config || settings.mobHunter;
                    if (active) this.toggleMobHunter(true, cfg);
                }
                if (settings.follow && settings.follow.active && this.toggleFollow) {
                    this.toggleFollow(true, settings.follow.config || {});
                }
                if (settings.autoMine && settings.autoMine.active && this.toggleAutoMine) {
                    this.toggleAutoMine(true, settings.autoMine.config || {});
                }
                if (settings.trash_cleaner && this.toggleTrashCleaner) {
                    const tc = settings.trash_cleaner;
                    const active = typeof tc === 'object' ? !!tc.active : !!tc;
                    const items = (typeof tc === 'object' && Array.isArray(tc.items)) ? tc.items : [];
                    if (active) this.toggleTrashCleaner(true, items);
                }
                if (settings.autoUse && this.toggleAutoUse) {
                    const au = settings.autoUse;
                    const active = typeof au === 'object' ? !!au.active : !!au;
                    const cfg = (typeof au === 'object' && Array.isArray(au.rules)) ? { rules: au.rules } : {};
                    if (active) this.toggleAutoUse(true, cfg);
                }
                const activeScript = settings.activeScript;
                if (activeScript && this._scripts && this._scripts[activeScript] && this._runningScript == null) {
                    logger.info(`[${this.config.username}] 断线恢复脚本: ${activeScript}`);
                    this.startScript(activeScript);
                }
            } catch (err) {
                logger.error(`[${this.config.username}] 模块恢复失败:`, err.message);
            }
        }, RESTORE_DELAY);
    }

    handleReconnect() {
        if (this.isExplicitlyQuitting) return;

        // 用户关闭了自动重连：断线后不再重连（fatal 之外的主动选择）
        if (this.config.settings?.autoReconnect === false) {
            logger.info(`[${this.config.username}] 自动重连已关闭，断开后不重连`);
            this.io.to(this._room).to('admin').emit('bot_error', {
                user: this.config.username,
                ownerId: this.config.ownerId,
                error: '已关闭自动重连'
            });
            return;
        }

        // 不可恢复的断开（被ban/白名单/版本不符等）：停止重连并通知，不消耗重试次数
        if (this._fatalReason) {
            logger.error(`[${this.config.username}] 不可恢复的断开(${this._fatalReason})，停止重连`);
            this.uiLog(`⛔ 已停止重连（不可恢复）：${this._fatalReason}`);
            this.io.to(this._room).to('admin').emit('bot_error', {
                user: this.config.username,
                ownerId: this.config.ownerId,
                error: `已停止重连：${this._fatalReason}`
            });
            return;
        }

        if (this.maxReconnectAttempts > 0 && this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error(`[${this.config.username}] 达到最大重连次数(${this.maxReconnectAttempts})，停止重连`);
            this.io.to(this._room).to('admin').emit('bot_error', {
                user: this.config.username,
                ownerId: this.config.ownerId,
                error: '达到最大重连次数，已停止重连'
            });
            return;
        }

        this.reconnectAttempts++;
        const baseDelay = this.config.settings?.reconnectDelay || 5;
        const delay = baseDelay * this.reconnectBackoff;
        this.reconnectBackoff = Math.min(this.reconnectBackoff * 1.5, 10);

        logger.info(`[${this.config.username}] 将在 ${delay.toFixed(1)}秒后重连 (第${this.reconnectAttempts}次尝试)`);
        this.uiLog(`将在 ${delay.toFixed(1)} 秒后重连（第 ${this.reconnectAttempts} 次）`);

        this.reconnectTimer = setTimeout(() => this.init(), delay * 1000);
    }

    setupEvents() {
        if (!this.bot) return;

        // 优化消息处理逻辑
        this.bot.on('message', (jsonMsg, position) => {
            // 保留 §/§x 颜色与格式码（前端渲染彩色）；尾部 ANSI 清洗对 §motd 无副作用
            const raw = (typeof jsonMsg.toMotd === "function" ? jsonMsg.toMotd() : jsonMsg.toString()).replace(/\u001b\[[0-9;]*m/g, '');
            if (!raw.trim()) return;

            // actionbar（物品栏上方文本，position=game_info）：存最新值（供 AI 观测），
            // 并作为一条日志推到「日志」页和聊天并排显示。去重(文本变才发)+节流(≥1.5s)防 HUD 每 tick 刷屏。
            if (position === 'game_info') {
                const abText = raw.replace(/§./gi, '').trim();
                this._actionBar = { text: abText, at: Date.now() };
                if (abText && abText !== this._lastAbText && Date.now() - (this._lastAbAt || 0) > 1500) {
                    this._lastAbText = abText;
                    this._lastAbAt = Date.now();
                    this.io.to(this._room).to('admin').emit('log', {
                        user: this.config.username, ownerId: this.config.ownerId,
                        msg: raw, // 保留 §色码供前端彩色渲染
                        time: new Date().toLocaleTimeString(),
                        actionbar: true
                    });
                }
                return;
            }

            // 可点击/可悬浮聊天：提取 click(点→执行命令/开链接) / hover(悬浮→展示物品/文字)。
            // 这类通知消息立即作为独立日志发(带 segments,便于前端渲染按钮)，不进 debounce 合并。
            const segments = [];
            try { extractChatSegments(jsonMsg.json || jsonMsg, {}, segments); } catch (e) { /* ignore */ }
            if (segments.some((s) => s.click || s.hover)) {
                this.io.to(this._room).to('admin').emit('log', {
                    user: this.config.username, ownerId: this.config.ownerId,
                    msg: raw, time: new Date().toLocaleTimeString(), chat: true, segments,
                });
                return;
            }

            this.msgBuffer += raw + "\n";
            if (this.msgTimeout) clearTimeout(this.msgTimeout);
            this.msgTimeout = setTimeout(() => {
                this.io.to(this._room).to('admin').emit('log', {
                    user: this.config.username,
                    ownerId: this.config.ownerId,
                    msg: this.msgBuffer.trim(),
                    time: new Date().toLocaleTimeString(),
                    chat: true // 服务器聊天（区别于机器人操作日志）
                });
                this.msgBuffer = "";
            }, 100);
        });

        this.bot.on('end', () => {
            logger.warn(`[${this.config.username}] 连接已断开`);
            this.io.to(this._room).to('admin').emit('status', {
                user: this.config.username,
                ownerId: this.config.ownerId,
                online: false
            });
            this.cleanup();
            this.handleReconnect();
        });

        // 模组服(龙核 DragonCore 等)常见：香草协议解析器读不动某些模组包/区块 → 抛 "varint is too big"
        // 等解析错误，但这是【非致命】的——连接不断、bot 照常在线(实测登录后只报一次、随即「连接稳定」)。
        // 故把这类良性解析错误降级：不当「连接出错」报警、每次连接只平静提示一次，避免吓人/刷屏。
        let benignParseWarned = false;
        // E10：logger.warn 限频——模组服解析错误风暴可达 20 次/s，逐条落盘一天能写 100MB 日志。
        // 首条照记，之后 60s 窗口内只计数，窗口结束补一条汇总。
        let benignLogWindowStart = 0;
        let benignSuppressed = 0;
        const BENIGN_PARSE_ERR = /varint is too big|PartialReadError|Chunk size is|Read error for|unexpected buffer end/i;
        this.bot.on('error', (err) => {
            const msg = err && err.message ? err.message : String(err);
            if (BENIGN_PARSE_ERR.test(msg)) {
                const now = Date.now();
                if (now - benignLogWindowStart >= 60000) {
                    if (benignSuppressed > 0) {
                        logger.warn(`[${this.config.username}] 过去 60s 内已忽略 ${benignSuppressed} 条良性解析错误`);
                    }
                    benignLogWindowStart = now;
                    benignSuppressed = 0;
                    logger.warn(`[${this.config.username}] 忽略良性解析错误: ${msg}`);
                } else {
                    benignSuppressed++;
                }
                if (!benignParseWarned) {
                    benignParseWarned = true;
                    this.uiLog('ℹ️ 模组服部分世界数据无法解析（已忽略，不影响聊天/钓鱼/指令；走动请用「直发移动」）');
                }
                return;
            }
            logger.error(`[${this.config.username}] 核心错误:`, msg);
            this.uiLog(`连接出错: ${msg}`);
        });

        // 解析踢出原因：命中"不可恢复"关键词则标记，handleReconnect 据此停止重连（避免无意义重连）
        this.bot.on('kicked', (reason) => {
            const text = extractText(reason).replace(/§./gi, '').trim();
            logger.warn(`[${this.config.username}] 被踢出: ${text || '(无原因)'}`);
            this.io.to(this._room).to('admin').emit('log', {
                user: this.config.username, ownerId: this.config.ownerId,
                msg: `被服务器踢出: ${text || '(无原因)'}`, time: new Date().toLocaleTimeString()
            });
            if (isFatalKick(reason)) this._fatalReason = text || '不可恢复的断开';
        });

        // 自动复活：mineflayer 默认死亡即自动重生（无需手动）。此处仅记录可见日志，
        // 并在复活后按需执行回点指令（多世界 RPG 服死亡会回主城，用 /back、/spawn 等返回）。
        this.bot.on('death', () => {
            this.io.to(this._room).to('admin').emit('log', {
                user: this.config.username, ownerId: this.config.ownerId,
                msg: '机器人死亡，正在自动复活…', time: new Date().toLocaleTimeString()
            });
            // 捕获死亡点（用最后一次存活坐标——death 时 entity 常已失效）：供「死亡返回」与脚本变量 {deathX/Y/Z}
            const dp = this._lastAlivePos;
            if (dp) {
                this._deathPos = dp;
                this._scriptVars = this._scriptVars || {};
                this._scriptVars.deathX = Math.round(dp.x);
                this._scriptVars.deathY = Math.round(dp.y);
                this._scriptVars.deathZ = Math.round(dp.z);
                this.io.to(this._room).to('admin').emit('log', {
                    user: this.config.username, ownerId: this.config.ownerId,
                    msg: `已记录死亡点 ${Math.round(dp.x)}, ${Math.round(dp.y)}, ${Math.round(dp.z)}`,
                    time: new Date().toLocaleTimeString()
                });
            }
            const respawnCmd = this.config.settings?.respawnCommand?.trim();
            if (respawnCmd) {
                const epoch = this._epoch;
                this.pushOneShot(() => {
                    if (this._epoch !== epoch || !this.bot) return;
                    // API-1：复活指令也过安全过滤（防有人把 /op 之类塞进 respawnCommand 绕过唯一防线）
                    if (isChatBlocked(respawnCmd)) {
                        logger.warn(`[${this.config.username}] 复活指令被安全过滤拦截，已跳过: ${respawnCmd}`);
                        return;
                    }
                    this.bot.chat(respawnCmd);
                    this.io.to(this._room).to('admin').emit('log', {
                        user: this.config.username, ownerId: this.config.ownerId,
                        msg: `复活后执行: ${respawnCmd}`, time: new Date().toLocaleTimeString()
                    });
                }, 1500);
            }
            // 死亡返回：开关开启且有死亡点 → 等重生+复活指令(若有)生效后，寻路走回死亡点。
            // 模组服寻路可能因 varint 失败（本期不优化）；走不到不卡死（move 只设目标，后台寻路）。
            // 互斥：追怪激活且会自己回区时让位——否则两边各设一次寻路目标（2s 回区、3.5s 回死亡点）互相覆盖来回抖。
            const hunterWillReturn = this.mobHunterTask?.active &&
                this.mobHunterTask.autoReturnOnDeath && !this.mobHunterTask.stopOnDeath;
            if (this.config.settings?.returnOnDeath && dp && hunterWillReturn) {
                this.io.to(this._room).to('admin').emit('log', {
                    user: this.config.username, ownerId: this.config.ownerId,
                    msg: '追怪运行中，死亡返回让位给追怪的回区逻辑', time: new Date().toLocaleTimeString()
                });
            } else if (this.config.settings?.returnOnDeath && dp) {
                const epoch = this._epoch;
                this.pushOneShot(() => {
                    if (this._epoch !== epoch || !this.bot?.entity) return;
                    this.io.to(this._room).to('admin').emit('log', {
                        user: this.config.username, ownerId: this.config.ownerId,
                        msg: `正在返回死亡点 ${Math.round(dp.x)}, ${Math.round(dp.y)}, ${Math.round(dp.z)}…`,
                        time: new Date().toLocaleTimeString()
                    });
                    this.move(dp.x, dp.y, dp.z);
                }, 3500); // 等重生 + respawnCommand(1.5s) + 服务器传送
            }
        });
    }

    /**
     * 核心修复：必须将 combatConfig 完整推送到前端，否则 UI 无法渲染配置界面
     * 增加 ownerId 用于前端过滤
     */
    updateStatus() {
        if (!this.bot?.entity) return;
        const pos = this.bot.entity.position;
        // 持续记录存活时的最后坐标：死亡时 entity 可能已失效，用它当「死亡点」（死亡返回 / 脚本 {deathX/Y/Z}）
        this._lastAlivePos = { x: pos.x, y: pos.y, z: pos.z };
        const modules = {
            combat: this.combatConfig.enabled,
            combatConfig: this.combatConfig,
            fishing: this.fishingActive,
            reconnectDelay: this.config.settings?.reconnectDelay || 5,
            schedules: this.config.settings?.schedules || []
        };
        // 网络延迟（tablist ping，毫秒）；取不到为 null
        const ping = typeof this.bot.player?.ping === 'number' ? this.bot.player.ping : null;
        // 变化检测：坐标取整+生命+延迟(25ms 桶)+模块/存档作签名。静止挂机(钓鱼/待命)时避免每 2s 空推；
        // 无变化时也最多 30s 保活推一次，不影响前端在线显示。
        const pingBucket = ping == null ? 'x' : Math.round(ping / 25);
        // CORE-8：签名只取少量标量，不再每 2s 对完整 modules(含 combatConfig/schedules) 做 JSON.stringify。
        //  · combatConfig 各关键标量直接拼接（5 个布尔/数字，配置变化时签名随之变化）；
        //  · schedules 只在「数组引用变化」时重算指纹（编辑定时会经 updateBot 换成新数组，引用即变），
        //    平时挂机直接复用缓存，避免每拍序列化整张定时表。
        const cc = this.combatConfig;
        const ccSig = `${cc.enabled ? 1 : 0}/${cc.range}/${cc.maxTargets}/${cc.antiKb ? 1 : 0}/${cc.attackPlayers ? 1 : 0}/${cc.attackMobs ? 1 : 0}`;
        // 定时表很小（几条 {time,command}），直接序列化即可——之前用「数组引用变化」判断会漏掉
        // scheduler:add/remove 的原地 push/splice（引用不变→状态不刷新），故改为每次 stringify（微秒级、必定正确）。
        const schedules = this.config.settings?.schedules || [];
        const schedulesSig = schedules.length ? JSON.stringify(schedules) : '0';
        const modSig = `${ccSig}|${this.fishingActive ? 1 : 0}|${this.config.settings?.reconnectDelay || 5}|${schedulesSig}`;
        const sig = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}|${this.bot.health}|${this.bot.food}|${this.bot.experience?.level || 0}|${pingBucket}|${this.savedLocations.length}|${modSig}`;
        const now = Date.now();
        if (sig === this._lastStatusSig && now - this._lastStatusEmitAt < 30000) return;
        this._lastStatusSig = sig;
        this._lastStatusEmitAt = now;
        // 无人观看：签名照常推进（_lastAlivePos 等内部状态已更新），但省掉 构建摘要+广播。
        // 新前端连上时 handlers.ts 的 BOTS_SNAPSHOT 提供全量首帧，无回归面。
        if (!this.hasWatchers()) return;
        this.io.to(this._room).to('admin').emit('status', {
            user: this.config.username,
            host: this.config.host,
            ownerId: this.config.ownerId,
            online: true,
            pos,
            health: this.bot.health,
            food: this.bot.food,
            level: this.bot.experience?.level || 0,
            ping,
            savedLocations: this.savedLocations,
            modules
        });
    }

    // minecraft-data 单例缓存（按版本）：避免各模块各自重复 require/实例化（重活，尤其高频调用处）。
    getMcData() {
        const v = this.bot?.version;
        if (!this._mcData || this._mcDataVersion !== v) {
            this._mcData = require('minecraft-data')(v);
            this._mcDataVersion = v;
        }
        return this._mcData;
    }

    // 构建寻路移动策略。
    // 默认「无破坏模式」：不挖方块、不搭脚手架、不搭柱子——多数服务器地图受保护，
    // 挖/搭都会失败并让寻路反复卡死。设 settings.allowDig=true 可恢复破坏式寻路（自建/创造服适用）。
    makeMovements() {
        const mcData = this.getMcData();
        const m = new Movements(this.bot, mcData);
        const allowDig = !!this.config.settings?.allowDig;
        m.canDig = allowDig;
        if (!allowDig) {
            m.scafoldingBlocks = []; // 不放置脚手架方块
            m.allow1by1towers = false; // 不搭柱子
        }
        return m;
    }

    // 把当前的移动策略应用到 pathfinder（登录后及切换破坏模式时调用）。
    applyMovements() {
        try {
            if (this.bot?.pathfinder) this.bot.pathfinder.setMovements(this.makeMovements());
        } catch (e) {
            logger.error(`[${this.config.username}] 应用寻路策略失败:`, e.message);
        }
    }

    // 寻路实现
    move(x, y, z) {
        if (this.bot?.pathfinder) {
            this.bot.pathfinder.setMovements(this.makeMovements());
            this.bot.pathfinder.setGoal(new goals.GoalBlock(x, y, z));

            const mode = this.config.settings?.allowDig ? '破坏' : '无破坏';
            this.io.to(this._room).to('admin').emit('log', {
                user: this.config.username,
                ownerId: this.config.ownerId,
                msg: `启动寻路至 ${x}, ${y}, ${z}（${mode}模式）`,
                time: new Date().toLocaleTimeString()
            });
        }
    }

    // 辅助存盘：供模块（如 fishing.js）在自动关闭时调用
    saveConfig() {
        if (typeof this.saveCallback === 'function') {
            this.saveCallback();
        }
    }

    cleanup() {
        // 1. 调用所有模块的清理钩子
        if (this.cleanupHooks && this.cleanupHooks.length > 0) {
            this.cleanupHooks.forEach(hook => {
                try {
                    hook();
                } catch (err) {
                    logger.error(`[${this.config.username}] 模块清理失败:`, err.message);
                }
            });
            // 清空钩子数组，准备下次重新注册
            this.cleanupHooks = [];
        }

        // 2. 清理所有定时器
        if (this.timers && this.timers.length > 0) {
            this.timers.forEach(timer => {
                try {
                    clearTimeout(timer);
                    clearInterval(timer);
                } catch (err) {
                    // 忽略清理失败的定时器
                }
            });
            this.timers = [];
        }

        // 3. 清理消息缓冲定时器
        if (this.msgTimeout) {
            clearTimeout(this.msgTimeout);
            this.msgTimeout = null;
            this.msgBuffer = "";
        }

        // 4. 清理重连和状态定时器
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.stableTimer) {
            clearTimeout(this.stableTimer);
            this.stableTimer = null;
        }

        if (this.statusTimer) {
            clearInterval(this.statusTimer);
            this.statusTimer = null;
        }

        // 5. 清理bot实例
        if (this.bot) {
            this.bot.removeAllListeners();
            try {
                this.bot.quit();
            } catch (e) {
                // 忽略quit失败
            }
            this.bot = null;
        }

        logger.info(`[${this.config.username}] 资源已清理`);
    }

    stop() {
        this.isExplicitlyQuitting = true;
        this.destroyed = true;          // 置销毁标记：任何延迟回调/陈旧定时器触发的 init() 都会 bail(CORE-1)
        // 归零重连计数：summary 的 reconnecting 按 attempts>0 推导，正在重连循环中被手动
        // 停止的 bot 若不归零，UI 会永远显示「重连中」（实际已不会再重连）
        this.reconnectAttempts = 0;
        this.reconnectBackoff = 1;
        this.cleanup();
        this.io.to(this._room).to('admin').emit('status', { user: this.config.username, ownerId: this.config.ownerId, online: false });
    }

    reconnect() {
        logger.info(`[${this.config.username}] 手动重连请求`);
        this.isExplicitlyQuitting = false;
        this.destroyed = false;         // 手动重连：撤销 stop() 的销毁标记
        this._fatalReason = null;       // 手动重连：清除致命标记，重新尝试
        this._forgeMods = undefined;    // 手动重连：重新探测 Forge 模组（服务器模组可能变化）
        this.reconnectAttempts = 0;
        this.reconnectBackoff = 1;
        this.cleanup();
        // 句柄入 this.reconnectTimer（cleanup 会清它）：随后的 stop()/delete 能取消，杜绝已停止的 bot 被复活(CORE-1)
        this.reconnectTimer = setTimeout(() => this.init(), 1000);
    }

    // 地点管理功能
    saveLocation(name, command, steps) {
        if (!this.bot?.entity) {
            return { success: false, error: '机器人未在线' };
        }

        if (this.savedLocations.length >= 12) {
            return { success: false, error: '已达到最大保存数量（12个）' };
        }

        const pos = this.bot.entity.position;
        const location = {
            id: Date.now().toString(),
            name: name,
            command: command || undefined,
            // 到达脚本（开菜单/点格子等，多世界/GUI 传送通用）；为空则回退到 command/坐标
            steps: Array.isArray(steps) && steps.length ? steps : undefined,
            x: Math.floor(pos.x),
            y: Math.floor(pos.y),
            z: Math.floor(pos.z),
            // 记录维度：跨维度且无到达方式时「前往」快速失败，而不是寻路 60 秒超时。
            // 注意 Bukkit 多世界的自定义世界客户端常显示 overworld，分不清时靠 command/steps 兜底。
            dimension: this.bot.game?.dimension || undefined,
            createdAt: Date.now()
        };

        this.savedLocations.push(location);
        this.saveConfig();

        this.io.to(this._room).to('admin').emit('log', {
            user: this.config.username,
            ownerId: this.config.ownerId,
            msg: `已保存地点: ${name} (${location.x}, ${location.y}, ${location.z})`,
            time: new Date().toLocaleTimeString()
        });

        return { success: true, location };
    }

    deleteLocation(locationId) {
        const index = this.savedLocations.findIndex(loc => loc.id === locationId);
        if (index === -1) {
            return { success: false, error: '地点不存在' };
        }

        const deleted = this.savedLocations.splice(index, 1)[0];
        this.saveConfig();

        this.io.to(this._room).to('admin').emit('log', {
            user: this.config.username,
            ownerId: this.config.ownerId,
            msg: `已删除地点: ${deleted.name}`,
            time: new Date().toLocaleTimeString()
        });

        return { success: true, deleted };
    }

    goToLocation(locationId) {
        const location = this.savedLocations.find(loc => loc.id === locationId);
        if (!location) {
            return { success: false, error: '地点不存在' };
        }

        // 优先：到达脚本（开菜单→点地点等，GUI/多世界传送通用，回放完整动作序列）
        if (Array.isArray(location.steps) && location.steps.length && typeof this.runSteps === 'function') {
            return this.runSteps(location.steps, `前往「${location.name}」`);
        }

        // 跨维度且没有任何到达方式：寻路注定 60 秒超时，直接快速失败给出可操作的提示
        const curDim = this.bot.game?.dimension;
        if (!location.command && location.dimension && curDim && location.dimension !== curDim) {
            return {
                success: false,
                error: `「${location.name}」在 ${location.dimension}，当前在 ${curDim}——请为该地点配置前置指令或录制到达脚本`,
            };
        }

        // 其次：前置指令切图 → 等传送真的发生（位置跳变/维度变化，最多 8 秒）→ 再寻路。
        // 旧实现固定等 2.5 秒就开走：传送排队/确认菜单/网络延迟都会让机器人在原世界乱跑。
        if (location.command) {
            // API-1：地点 warp 指令也过安全过滤（与 respawn 同理，堵命令注入旁路）
            if (isChatBlocked(location.command)) {
                return { success: false, error: '到达指令被安全过滤拦截' };
            }
            this.bot.chat(location.command);
            this.io.to(this._room).to('admin').emit('log', {
                user: this.config.username,
                ownerId: this.config.ownerId,
                msg: `切图指令: ${location.command}，等待传送完成…`,
                time: new Date().toLocaleTimeString()
            });
            const epoch = this._epoch;
            (async () => {
                const moved = await waitForTeleport(this.bot, { timeoutMs: 8000 });
                if (this._epoch !== epoch || !this.bot?.entity) return; // 期间断连/重建：放弃陈旧寻路
                this.io.to(this._room).to('admin').emit('log', {
                    user: this.config.username,
                    ownerId: this.config.ownerId,
                    msg: moved ? '传送完成，开始寻路' : '8 秒内未检测到传送（可能已在附近），按坐标寻路',
                    time: new Date().toLocaleTimeString()
                });
                this.move(location.x, location.y, location.z);
            })();
        } else {
            // 兜底：当前世界内寻路到坐标
            this.move(location.x, location.y, location.z);
        }
        return { success: true, location };
    }

    // 更新已存在地点的「到达方式」（前置指令 / 录制的到达脚本）
    setLocationReach(locationId, reach = {}) {
        const location = this.savedLocations.find(loc => loc.id === locationId);
        if (!location) {
            return { success: false, error: '地点不存在' };
        }
        if (reach.command !== undefined) location.command = reach.command || undefined;
        if (reach.steps !== undefined) {
            location.steps = Array.isArray(reach.steps) && reach.steps.length ? reach.steps : undefined;
        }
        this.saveConfig();
        this.io.to(this._room).to('admin').emit('log', {
            user: this.config.username,
            ownerId: this.config.ownerId,
            msg: `已更新地点「${location.name}」的到达方式`,
            time: new Date().toLocaleTimeString()
        });
        return { success: true, location };
    }
}

module.exports = BotInstance;