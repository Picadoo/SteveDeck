const _fs = require('fs');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const collectBlock = require('mineflayer-collectblock').plugin;
const logger = require('./utils/logger');
const { Recorder } = require('./modules/recorder');


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

        // 保存的地点（软上限 200，防滥用；地点数据极小，正常使用无上限感）
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

    // 推一条 per-bot 日志到前端「日志」tab：连接生命周期/错误都走这里，
    // 避免用户连接时一片空白、不知道进没进服务器（用户明确反馈过的痛点）。
    uiLog(msg) {
        try {
            this.io.to(this._room).to('admin').emit('log', {
                user: this.config.username, ownerId: this.config.ownerId,
                msg, time: new Date().toLocaleTimeString()
            });
        } catch (_e) { /* ignore */ }
    }

    // 结构化关键事件（death/kick/offline/online）：推 Webhook 挂机通知。
    // 与 uiLog 分开——uiLog 是给「开着客户端的人」看的，这里是给「人不在」的场景推手机。
    notifyEvent(kind, message) {
        try {
            require('./notify/webhook').publishBotEvent({
                kind,
                botId: this.config.id,
                username: this.config.username,
                host: this.config.host,
                message,
            });
        } catch (_e) { /* 通知不可用不影响主流程 */ }
    }

    // 直接坐标包移动（模组服）：实现见 instance/rawMove.js；此 getter 是开关判定，留在核心。
    get rawMoveEnabled() { return !!this.config?.settings?.rawMove; }

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
            this._forgeMods = (detected?.length) ? detected : (Array.isArray(this.config.settings?.forgeMods) ? this.config.settings.forgeMods : []);
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

            // Forge/FML 模组服：伪装 Forge 客户端 + FML 握手状态机（见 instance/forge.js）
            if (this.config.settings?.forge && this.bot._client) {
                this.installFmlHandshake(this.bot._client);
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
                this.notifyEvent('online', '已进入服务器'); // 默认关（重连成功也算，开着会偏吵）

                // 2. 模块挂载：逐个 try/catch 隔离——单个模块构造抛错不再连累后续模块与状态推送
                // lite 假人（氛围组）：防挂机踢 + 视角/背包（这两个只挂函数/轻监听，重活都在用户点开时才发生），
                // 其余功能模块（战斗/寻路/脚本等常驻监听）一律不挂，单只内存/CPU 压到最低
                const MODULE_NAMES = this.config.settings?.lite ? ['anti_afk', 'bot_viewer', 'player_inventory'] : [
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

    // restoreModules（重连后自动续上各模块激活状态）：见 instance/restore.js

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
            // 「彻底掉线且不会自己回来」是挂机场景最需要推到手机的事件
            this.notifyEvent('offline', `已停止重连（不可恢复）：${this._fatalReason}`);
            return;
        }

        if (this.maxReconnectAttempts > 0 && this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error(`[${this.config.username}] 达到最大重连次数(${this.maxReconnectAttempts})，停止重连`);
            this.io.to(this._room).to('admin').emit('bot_error', {
                user: this.config.username,
                ownerId: this.config.ownerId,
                error: '达到最大重连次数，已停止重连'
            });
            this.notifyEvent('offline', `达到最大重连次数（${this.maxReconnectAttempts}），已停止重连`);
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

    // setupEvents（消息流/断线/降噪/踢出/死亡处理）：见 instance/events.js
    // updateStatus / hasWatchers（状态推送 + 观众门控）：见 instance/status.js

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
                } catch (_err) {
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
            } catch (_e) {
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

    // 一键停止所有「主动行为」：脚本 + 正在执行的功能模块 + 移动/操控。
    // 有意保留 scheduler 的定时脚本（那是到点触发的调度，不属于"正在执行"，用户明确要保留）。
    stopAllActions() {
        const b = this.bot;
        // 1. 运行中的脚本（手动启动的循环/临时脚本 + 自定义 JS）
        try { this.stopScript?.(); } catch (_e) { /* ignore */ }
        try { this.stopCustomJs?.(); } catch (_e) { /* ignore */ }
        // 2. 正在执行的功能模块（逐个关，单个失败不连累其余）
        try { if (this.combatConfig) this.combatConfig.enabled = false; } catch (_e) { /* ignore */ }
        try { this.setFishing ? this.setFishing(false) : (this.fishingActive = false); } catch (_e) { /* ignore */ }
        try { this.stopAutoMine?.(); } catch (_e) { /* ignore */ }
        try { this.toggleAutoFarm?.(false, {}); } catch (_e) { /* ignore */ }
        try { this.toggleMobHunter?.(false, {}); } catch (_e) { /* ignore */ }
        try { this.toggleFollow?.(false, {}); } catch (_e) { /* ignore */ }
        try { this.toggleTrashCleaner?.(false, []); } catch (_e) { /* ignore */ }
        try { this.toggleAutoUse?.(false, {}); } catch (_e) { /* ignore */ }
        // 3. 移动 / 操控：立刻停下，不再寻路/按键
        try { if (b?.pathfinder) b.pathfinder.setGoal(null); } catch (_e) { /* ignore */ }
        try { b?.clearControlStates?.(); } catch (_e) { /* ignore */ }
        // scheduler（定时脚本）有意不动——到点运行不受影响
        try { this.uiLog?.('⏹ 已停止所有操作（定时脚本保留，到点照常运行）'); } catch (_e) { /* ignore */ }
        return { success: true };
    }

    // 地点管理（保存/删除/前往/更新到达方式）：见 instance/locations.js
}

// ===== 职责 mixin（拆分自本文件，this 语义与公共 API 不变）=====
Object.assign(BotInstance.prototype, require('./instance/forge').mixin);
Object.assign(BotInstance.prototype, require('./instance/rawMove').mixin);
Object.assign(BotInstance.prototype, require('./instance/locations').mixin);
Object.assign(BotInstance.prototype, require('./instance/events').mixin);
Object.assign(BotInstance.prototype, require('./instance/status').mixin);
Object.assign(BotInstance.prototype, require('./instance/restore').mixin);

module.exports = BotInstance;