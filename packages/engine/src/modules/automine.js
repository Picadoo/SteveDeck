// modules/automine.js — v2：合法挖矿(legit-mine) + 强拟人状态机
// 设计见 docs/superpowers/specs/2026-05-30-automine-v2-design.md
const { goals, Movements } = require('mineflayer-pathfinder');
const H = require('./mining/humanizer');
const gotoWithTimeout = require('../utils/gotoWithTimeout');
const { closestName } = require('../utils/closestName');

const DEFAULT_CONFIG = {
    targets: [], scanRadius: 32, queueSize: 16, humanize: 'high',
    mode: 'mine',         // mine=挖取采集, find=只定位不挖（探矿/找方块用）
    allowPlace: false,    // 搭方块脱困：背包有圆石/泥土等时允许垫脚搭柱（坑底上得来）
    advance: { enabled: true, direction: 'down', toward: 'ore', stepSize: 8, maxFails: 5 },
    onFull: { dropTrash: [], fallbackScript: null, scriptTimeout: 120 },
    hazardAvoid: false, restock: { enabled: false, chest: null }, survival: { enabled: false },
};

function normalizeConfig(arg, direction) {
    const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    if (Array.isArray(arg)) {
        cfg.targets = arg.slice();
        if (direction) cfg.advance.direction = direction;
    } else if (arg && typeof arg === 'object') {
        Object.assign(cfg, arg);
        // 兼容旧 UI 字段名 radius：之前 UI 发 radius、引擎读 scanRadius，「搜索半径」其实一直没生效
        if (arg.scanRadius == null && arg.radius != null) cfg.scanRadius = Number(arg.radius) || cfg.scanRadius;
        cfg.advance = { ...DEFAULT_CONFIG.advance, ...(arg.advance || {}) };
        cfg.onFull = { ...DEFAULT_CONFIG.onFull, ...(arg.onFull || {}) };
    }
    return cfg;
}

module.exports = (botInstance) => {
    const bot = botInstance.bot;
    const getMcData = () => botInstance.getMcData(); // 复用实例级单例缓存

    const task = botInstance.autoMineTask = {
        active: false, state: 'IDLE', config: JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
        queue: [], targetIds: [], advanceFails: 0, approachFails: 0, waitingScript: false, _current: null,
        stats: { minedByType: {}, total: 0, startTime: null, lastMine: null, fullEvents: 0 },
        _tickTimer: null,
        _veinQueue: [],          // 矿脉跟随：挖完一块后相邻的同矿排这里，优先于普通队列（FIFO 不随机挑）
        _blacklist: new Map(),   // 不可达黑名单: "x,y,z" -> 过期时间。寻路失败的矿暂时拉黑，不再反复撞墙
        area: null,              // 矩形挖矿区域 {x1,y1,z1,x2,y2,z2}；null=不限（sel1/sel2 定义）
        _sel1: null,             // sel1 暂存坐标，等 sel2 定义完整区域
        _regenLogAt: 0,          // 「等待刷新」日志限流
    };

    const BLACKLIST_MS = 180000; // 拉黑 3 分钟：环境会变（别人挖通了/自己挖出新通道），到期自动解禁
    const posKey = (p) => `${p.x},${p.y},${p.z}`;

    const emitLog = (msg) => botInstance.io.to(botInstance._room).to('admin').emit('log', {
        user: bot.username, ownerId: botInstance.config.ownerId, msg, time: new Date().toLocaleTimeString(),
    });

    const schedule = (ms) => {
        if (task._tickTimer) clearTimeout(task._tickTimer);
        if (task._manualTick) return; // 测试手动驱动模式：状态照常转移，但不自动调度，避免与手动 tick 重入
        // 滚动定时器：不再登记进 botInstance.timers（每 tick push 会让数组无限膨胀）；
        // 由 schedule 自身先 clear 上一个 + cleanupHook 统一 clear task._tickTimer 兜底。
        task._tickTimer = setTimeout(() => { tick().catch(e => emitLog(`tick异常: ${e.message}`)); }, ms);
    };

    function setState(s) { task.state = s; }

    async function tick() {
        if (!task.active || !bot.entity) return;
        if (botInstance.isBodyBusy && botInstance.isBodyBusy()) return; // 用东西时让位一拍(auto_use)
        switch (task.state) {
            case 'SCAN': return doScan();
            case 'APPROACH': return doApproach();
            case 'MINE': return doMine();
            case 'ADVANCE': return doAdvance();
            case 'PAUSE': return doPause();
            default: return;
        }
    }

    // ==================== 辅助 ====================
    function emptySlots() {
        return bot.inventory.slots.filter((s, i) => i >= 9 && i <= 44 && !s).length;
    }

    function buildTargetIds() {
        const mc = getMcData();
        // 拼写体检：无效方块名会被静默丢弃（部分拼错时模块照常跑、用户不知道漏了），
        // 启动后第一次构建时逐个点名 + 就近建议
        if (!task._warnedBadTargets) {
            task._warnedBadTargets = true;
            const bad = task.config.targets.filter(n => !mc.blocksByName[n]);
            if (bad.length) {
                const names = Object.keys(mc.blocksByName);
                for (const b of bad) {
                    const tip = closestName(b, names);
                    emitLog(`⚠ 方块名「${b}」无效，已忽略${tip ? `——是不是想填 ${tip}？` : ''}`);
                }
            }
        }
        return task.config.targets
            .map(name => mc.blocksByName[name] && mc.blocksByName[name].id)
            .filter(id => id !== undefined && id !== null);
    }

    function distSqTo(p) {
        const e = bot.entity.position;
        const dx = e.x - p.x, dy = e.y - p.y, dz = e.z - p.z;
        return dx * dx + dy * dy + dz * dz;
    }

    // 接近代价（Baritone 思路的简化版）：垂直格比水平格贵得多——向上要搭/绕（无破坏
    // 模式不搭，实际更贵），向下要找得到下去的路。纯直线距离会优先选头顶/脚下的矿，
    // 结果绕半天；按代价排能让它先吃同层的。
    function approachCost(p) {
        const e = bot.entity.position;
        const dx = e.x - p.x, dz = e.z - p.z;
        const dy = p.y - e.y;
        const horiz = Math.sqrt(dx * dx + dz * dz);
        return horiz + (dy > 0 ? 3 : 1.8) * Math.abs(dy);
    }

    // 区域判定：矩形包围盒（sel1/sel2 两点定义的长方体）
    function inMineArea(p) {
        if (!task.area) return true;
        const a = task.area;
        return p.x >= a.x1 && p.x <= a.x2 &&
               p.y >= a.y1 && p.y <= a.y2 &&
               p.z >= a.z1 && p.z <= a.z2;
    }

    function nextFromQueueOrScan() {
        // 矿脉队列也算"还有活"——矿脉吃到一半不回 SCAN（重扫会丢掉连挖顺序，白走一拍）
        if (task._veinQueue.length > 0 || task.queue.length > 0) { setState('APPROACH'); schedule(H.actionInterval(task.config.humanize, 400)); }
        else { setState('SCAN'); schedule(H.actionInterval(task.config.humanize, 300)); }
    }

    function advanceTarget() {
        // 区域模式：在矩形区域内随机挑个落点换位重扫（接近熔断后换视角用），不出区
        if (task.area) {
            const a = task.area;
            return {
                x: Math.floor(a.x1 + Math.random() * (a.x2 - a.x1)),
                y: Math.floor(a.y1 + Math.random() * (a.y2 - a.y1)),
                z: Math.floor(a.z1 + Math.random() * (a.z2 - a.z1)),
            };
        }
        const pos = bot.entity.position;
        const p = pos.clone ? pos.clone() : { x: pos.x, y: pos.y, z: pos.z };
        const step = (task.config.advance.stepSize || 8) + Math.round((Math.random() * 2 - 1) * 2);
        const dir = task.config.advance.direction || 'down';
        const off = { forward: [step, 0, 0], back: [-step, 0, 0], left: [0, 0, -step], right: [0, 0, step], up: [0, step, 0], down: [0, -step, 0] }[dir] || [0, -step, 0];
        let y = Math.floor(p.y + off[1]); if (y < 1) y = 1;
        return { x: Math.floor(p.x + off[0]), y, z: Math.floor(p.z + off[2]) };
    }

    async function dropTrashItems() {
        const names = task.config.onFull.dropTrash || [];
        if (names.length === 0) return false;
        const items = bot.inventory.items();
        let dropped = false;
        for (const item of items) {
            if (!task.active) break;
            if (names.some(n => item.name.includes(String(n).toLowerCase().trim()))) {
                try {
                    await bot.tossStack(item);
                    dropped = true;
                    await new Promise(r => setTimeout(r, H.actionInterval(task.config.humanize, 400)));
                } catch (e) { /* 单次丢弃失败忽略 */ }
            }
        }
        return dropped;
    }

    function waitScriptDone(timeoutMs) {
        return new Promise((resolve) => {
            const start = Date.now();
            const iv = setInterval(() => {
                if (!task.active) { clearInterval(iv); return resolve('aborted'); }
                if (!botInstance._runningScript) { clearInterval(iv); return resolve('done'); }
                if (Date.now() - start > timeoutMs) { clearInterval(iv); return resolve('timeout'); }
            }, 300);
        });
    }

    // ==================== 状态 ====================
    async function doScan() {
        if (emptySlots() === 0) { setState('PAUSE'); return schedule(200); }

        if (task.targetIds.length === 0) {
            task.targetIds = buildTargetIds();
            if (task.targetIds.length === 0) { emitLog('目标方块名无效，已停机'); return botInstance.stopAutoMine(); }
        }

        // 区域模式：人在区域外（死亡重生/被传送）先走回区域中心，再开始扫
        if (task.area && bot.entity) {
            const e = bot.entity.position;
            const a = task.area;
            if (e.x < a.x1 - 4 || e.x > a.x2 + 4 || e.z < a.z1 - 4 || e.z > a.z2 + 4) {
                emitLog('在挖矿区域外，返回区域中心');
                const cx = (a.x1 + a.x2) / 2, cy = (a.y1 + a.y2) / 2, cz = (a.z1 + a.z2) / 2;
                try { await gotoWithTimeout(bot, new goals.GoalNear(cx, cy, cz, 3), 30000); } catch (e2) { /* 走不回去下轮再试 */ }
                return schedule(500);
            }
        }

        // 黑名单 GC + 过滤：寻路失败拉黑过的矿在有效期内不再入队（否则换区域回来又撞同一块墙）
        const now = Date.now();
        for (const [k, exp] of task._blacklist) { if (exp <= now) task._blacklist.delete(k); }
        const positions = (bot.findBlocks({ matching: task.targetIds, maxDistance: task.config.scanRadius, count: task.config.queueSize }) || [])
            .filter(p => !task._blacklist.has(posKey(p)) && inMineArea(p));
        if (positions.length === 0) {
            // 区域模式下矿可能会刷新：原地等待重扫，不游走出区域
            if (task.area) {
                if (now - task._regenLogAt > 60000) { task._regenLogAt = now; emitLog('区域内暂无目标矿物，等待刷新…'); }
                return schedule(8000 + Math.random() * 7000);
            }
            setState('ADVANCE'); return schedule(H.actionInterval(task.config.humanize, 500));
        }

        task.queue = positions.slice().sort((a, b) => approachCost(a) - approachCost(b));
        setState('APPROACH');
        return schedule(H.aimDelay(task.config.humanize));
    }

    async function doApproach() {
        // 矿脉优先：挖完一块先把相邻的同矿吃干净（FIFO 不随机挑——真人也是连着挖整条矿脉）
        let pos = null;
        while (task._veinQueue.length > 0) {
            const cand = task._veinQueue.shift();
            const b = bot.blockAt(cand);
            if (b && task.targetIds.includes(b.type)) { pos = cand; break; } // 失效的(被挖/塌掉)直接丢
        }
        if (!pos) {
            if (task.queue.length === 0) { setState('SCAN'); return schedule(200); }
            const idx = H.pickTargetIndex(task.queue.length, task.config.humanize);
            pos = task.queue[idx];
            task.queue.splice(idx, 1);
        }
        task._current = pos;
        try {
            // 带超时：不可达目标的 goto 可能永不返回（挂死在 APPROACH）；超时 throw 进熔断计数
            await gotoWithTimeout(bot, new goals.GoalNear(pos.x, pos.y, pos.z, 2), 20000); // 留余量，更像玩家
            task.approachFails = 0; // 成功到达，清零熔断计数
            setState('MINE');
            return schedule(H.aimDelay(task.config.humanize)); // 瞄准延迟
        } catch (e) {
            // 寻路失败熔断：连续够不到目标（隔墙/卡住）时不死循环，转 ADVANCE 换区域重扫
            task._blacklist.set(posKey(pos), Date.now() + BLACKLIST_MS); // 这块先拉黑，重扫不再入队
            task.approachFails++;
            if (task.approachFails >= (task.config.advance.maxFails || 5)) {
                task.approachFails = 0;
                task.queue = [];
                emitLog('连续无法到达目标矿，转移到新区域');
                setState('ADVANCE');
                return schedule(H.actionInterval(task.config.humanize, 800));
            }
            setState('APPROACH'); // 寻路失败：取下一个
            return schedule(H.actionInterval(task.config.humanize, 300));
        }
    }

    async function doMine() {
        const pos = task._current;
        if (!pos) return nextFromQueueOrScan();
        const block = bot.blockAt(pos);
        // 挖前校验：仍是目标方块（防止被他人挖走/变化）
        if (!block || (!task.targetIds.includes(block.type) && !task.config.targets.includes(block.name))) {
            return nextFromQueueOrScan();
        }

        // 寻找模式：只定位不挖——到目标方块旁记录坐标，然后找下一个
        if (task.config.mode === 'find') {
            task.stats.found = (task.stats.found || 0) + 1;
            emitLog(`发现 ${block.name} (${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`);
            return nextFromQueueOrScan();
        }

        // 装最佳工具；无合适工具则跳过告警（不空手硬挖）
        let tool = null;
        try { tool = bot.pathfinder.bestHarvestTool(block); if (tool) await bot.equip(tool, 'hand'); } catch (e) {}
        const canDig = typeof bot.canDigBlock === 'function' ? bot.canDigBlock(block) : true;
        if (!tool && !canDig) { emitLog(`无合适工具，跳过 ${block.name}`); return nextFromQueueOrScan(); }

        try {
            await bot.lookAt(pos.offset ? pos.offset(0.5, 0.5, 0.5) : { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 }, true);
            await bot.dig(block);
            const name = block.name;
            task.stats.minedByType[name] = (task.stats.minedByType[name] || 0) + 1;
            task.stats.total++;
            task.stats.lastMine = Date.now();

            // 矿脉跟随：矿脉是连通的——挖完一块扫 26 邻域，相邻同矿排到矿脉队列优先吃完，
            // 不再挖一块就按旧队列走人（半条矿脉留在身后）。逐块接力即可吃完整条矿脉。
            if (pos.offset) {
                const veinStart = task._veinQueue.length === 0;
                let added = 0;
                for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
                    if (!dx && !dy && !dz) continue;
                    const np = pos.offset(dx, dy, dz);
                    const nb = bot.blockAt(np);
                    if (!nb || !task.targetIds.includes(nb.type)) continue;
                    const k = posKey(np);
                    if (task._blacklist.has(k)) continue;
                    if (task._veinQueue.some(v => posKey(v) === k)) continue;
                    task._veinQueue.push(np);
                    added++;
                }
                if (veinStart && added > 0) emitLog(`矿脉跟随: 发现相邻 ${added} 块 ${name}，连挖`);
            }
        } catch (e) { /* 挖掘失败跳过 */ }

        if (H.shouldPause(task.config.humanize)) {
            await new Promise(r => setTimeout(r, H.pauseDuration(task.config.humanize)));
        }
        return nextFromQueueOrScan();
    }

    async function doAdvance() {
        if (!task.config.advance.enabled) { setState('SCAN'); return schedule(1000); }
        const t = advanceTarget();
        try {
            await gotoWithTimeout(bot, new goals.GoalNear(t.x, t.y, t.z, 1), 20000);
            task.advanceFails = 0;
            setState('SCAN');
            return schedule(H.actionInterval(task.config.humanize, 400));
        } catch (e) {
            task.advanceFails++;
            if (task.advanceFails >= (task.config.advance.maxFails || 5)) {
                emitLog(`连续 ${task.advanceFails} 次无法推进，停机`);
                return botInstance.stopAutoMine();
            }
            setState('ADVANCE');
            return schedule(H.actionInterval(task.config.humanize, 1500));
        }
    }

    async function doPause() {
        if (task.waitingScript) return; // 正在等脚本，避免重入
        task.stats.fullEvents++;
        emitLog('背包已满，执行清理策略...');

        // 1) 先丢垃圾
        const dropped = await dropTrashItems();
        if (dropped) await new Promise(r => setTimeout(r, 500)); // 等服务器同步背包，避免刚丢完仍读到满
        if (emptySlots() > 0) { setState('SCAN'); return schedule(H.actionInterval(task.config.humanize, 500)); }

        // 2) 仍满 → 回收脚本
        const sname = task.config.onFull.fallbackScript;
        const hasScript = sname && botInstance._scripts && botInstance._scripts[sname];
        if (hasScript && typeof botInstance.startScript === 'function') {
            if (botInstance._runningScript) { await waitScriptDone((task.config.onFull.scriptTimeout || 120) * 1000); }
            emitLog(`调用回收脚本: ${sname}`);
            task.waitingScript = true;
            try { if (bot.pathfinder) bot.pathfinder.setGoal(null); } catch (e) {}
            botInstance.startScript(sname);
            const res = await waitScriptDone((task.config.onFull.scriptTimeout || 120) * 1000);
            task.waitingScript = false;
            if (res === 'timeout') { emitLog('回收脚本超时，停机'); return botInstance.stopAutoMine(); }
            if (!task.active) return;
            setState('SCAN');
            return schedule(H.actionInterval(task.config.humanize, 500));
        }

        // 3) 保底
        emitLog('背包满且无可用清理策略（无垃圾可丢/未配回收脚本），停机');
        return botInstance.stopAutoMine();
    }

    // ==================== 对外 API ====================
    botInstance.toggleAutoMine = (active, arg = [], direction = 'down') => {
        if (active) {
            task.config = normalizeConfig(arg, direction);
            task.targetIds = [];
            task._warnedBadTargets = false;
            task.advanceFails = 0;
            task.waitingScript = false;
            task._veinQueue = [];
            task._blacklist = new Map();
            task._regenLogAt = 0;
            task.stats = { minedByType: {}, total: 0, startTime: Date.now(), lastMine: null, fullEvents: 0 };
            task.active = true;
            setState('SCAN');

            // 挖矿区域：从配置还原 sel1/sel2 设定的矩形选区（重启不丢失）
            task.area = null;
            task._sel1 = null;
            const savedArea = botInstance.config.settings?.autoMine?.area;
            if (savedArea && savedArea.x1 !== undefined) {
                task.area = savedArea;
            }

            // 保守 Movements：不开极限跑酷，更像玩家（best-effort，失败不影响）
            try {
                // 统一「无破坏模式」策略（受保护服不挖不搭，避免寻路卡死）；再关掉极限跑酷
                const m = botInstance.makeMovements();
                m.allowParkour = false;
                if (task.config.allowPlace) {
                    // 搭方块脱困（Baritone 式垫脚）：背包有这些方块时，pathfinder 可搭柱/搭桥——挖到坑底也上得来
                    const mc = getMcData();
                    m.scafoldingBlocks = ['cobblestone', 'dirt', 'netherrack', 'cobbled_deepslate', 'stone']
                        .map(n => mc.itemsByName[n] && mc.itemsByName[n].id).filter(id => id != null);
                    m.allow1by1towers = true;
                }
                if (bot.pathfinder && bot.pathfinder.setMovements) bot.pathfinder.setMovements(m);
            } catch (e) {}

            botInstance.config.settings = botInstance.config.settings || {};
            botInstance.config.settings.autoMine = { active: true, config: task.config };
            if (typeof botInstance.saveConfig === 'function') botInstance.saveConfig();
            const areaText = task.area
                ? `(${task.area.x1},${task.area.y1},${task.area.z1})~(${task.area.x2},${task.area.y2},${task.area.z2})`
                : '不限';
            const modeText = task.config.mode === 'find' ? '寻找(不挖)' : '挖取';
            emitLog(`启动挖矿: ${task.config.targets.join(', ')} | 模式:${modeText} | 区域:${areaText} | 搭路:${task.config.allowPlace ? '开' : '关'}`);
            schedule(300);
        } else {
            botInstance.stopAutoMine();
        }
    };

    botInstance.stopAutoMine = () => {
        task.active = false;
        setState('IDLE');
        if (task._tickTimer) { clearTimeout(task._tickTimer); task._tickTimer = null; }
        try { if (bot.pathfinder) bot.pathfinder.setGoal(null); } catch (e) {}
        if (botInstance.config.settings && botInstance.config.settings.autoMine) {
            botInstance.config.settings.autoMine.active = false;
            if (typeof botInstance.saveConfig === 'function') botInstance.saveConfig();
        }
    };

    botInstance.getMineStats = () => {
        const s = task.stats;
        const runTime = s.startTime ? (Date.now() - s.startTime) / 60000 : 0;
        const out = {
            minedByType: s.minedByType, total: s.total,
            runTime: Math.floor(runTime), rate: (s.total / Math.max(runTime, 1)).toFixed(2),
            lastMine: s.lastMine ? new Date(s.lastMine).toLocaleTimeString() : '从未', fullEvents: s.fullEvents,
        };
        if (task.config.mode === 'find') out.found = s.found || 0;
        if (task.area) out.area = `(${task.area.x1},${task.area.y1},${task.area.z1})~(${task.area.x2},${task.area.y2},${task.area.z2})`;
        return out;
    };

    // ==================== 区域选取（sel1/sel2 矩形选区，类 Baritone） ====================
    botInstance.setMineAreaSel1 = () => {
        if (!bot.entity) return { success: false, error: '机器人未在线' };
        const p = bot.entity.position;
        task._sel1 = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
        emitLog(`挖矿区域角1: (${task._sel1.x}, ${task._sel1.y}, ${task._sel1.z})`);
        return { success: true, pos: task._sel1, needSel2: true };
    };

    botInstance.setMineAreaSel2 = () => {
        if (!bot.entity) return { success: false, error: '机器人未在线' };
        if (!task._sel1) return { success: false, error: '请先标记角1' };
        const p = bot.entity.position;
        const s2 = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
        task.area = {
            x1: Math.min(task._sel1.x, s2.x), y1: Math.min(task._sel1.y, s2.y), z1: Math.min(task._sel1.z, s2.z),
            x2: Math.max(task._sel1.x, s2.x), y2: Math.max(task._sel1.y, s2.y), z2: Math.max(task._sel1.z, s2.z),
        };
        task._sel1 = null;
        botInstance.config.settings = botInstance.config.settings || {};
        botInstance.config.settings.autoMine = botInstance.config.settings.autoMine || {};
        botInstance.config.settings.autoMine.area = task.area;
        if (typeof botInstance.saveConfig === 'function') botInstance.saveConfig();
        const a = task.area;
        emitLog(`挖矿区域已设定: (${a.x1},${a.y1},${a.z1}) ~ (${a.x2},${a.y2},${a.z2})`);
        return { success: true, area: task.area };
    };

    botInstance.clearMineArea = () => {
        task.area = null;
        task._sel1 = null;
        if (botInstance.config.settings?.autoMine) {
            delete botInstance.config.settings.autoMine.area;
            if (typeof botInstance.saveConfig === 'function') botInstance.saveConfig();
        }
        emitLog('已清除挖矿区域限制');
        return { success: true };
    };

    // ==================== 清理 ====================
    botInstance.cleanupHooks = botInstance.cleanupHooks || [];
    botInstance.cleanupHooks.push(() => {
        task.active = false; task.state = 'IDLE'; task.waitingScript = false;
        if (task._tickTimer) { clearTimeout(task._tickTimer); task._tickTimer = null; }
        try { if (bot.pathfinder) bot.pathfinder.setGoal(null); } catch (e) {}
    });

    // 测试钩子：仅在测试环境暴露内部
    if (process.env.NODE_ENV === 'test' || process.env.AUTOMINE_TEST) {
        botInstance._mineInternals = { tick, setState, getMcData, get task() { return task; } };
    }
};
