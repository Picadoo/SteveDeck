// modules/automine.js — v2：合法挖矿(legit-mine) + 强拟人状态机
// 设计见 docs/superpowers/specs/2026-05-30-automine-v2-design.md
const { goals, Movements } = require('mineflayer-pathfinder');
const H = require('./mining/humanizer');

const DEFAULT_CONFIG = {
    targets: [], scanRadius: 32, queueSize: 16, humanize: 'high',
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
        cfg.advance = { ...DEFAULT_CONFIG.advance, ...(arg.advance || {}) };
        cfg.onFull = { ...DEFAULT_CONFIG.onFull, ...(arg.onFull || {}) };
    }
    return cfg;
}

module.exports = (botInstance) => {
    const bot = botInstance.bot;
    let mcData = null;
    const getMcData = () => (mcData || (mcData = require('minecraft-data')(bot.version)));

    const task = botInstance.autoMineTask = {
        active: false, state: 'IDLE', config: JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
        queue: [], targetIds: [], advanceFails: 0, approachFails: 0, waitingScript: false, _current: null,
        stats: { minedByType: {}, total: 0, startTime: null, lastMine: null, fullEvents: 0 },
        _tickTimer: null, _lastStatsEmit: 0,
    };

    const emitLog = (msg) => botInstance.io.to(botInstance._room).to('admin').emit('log', {
        user: bot.username, ownerId: botInstance.config.ownerId, msg, time: new Date().toLocaleTimeString(),
    });

    const schedule = (ms) => {
        if (task._tickTimer) clearTimeout(task._tickTimer);
        if (task._manualTick) return; // 测试手动驱动模式：状态照常转移，但不自动调度，避免与手动 tick 重入
        task._tickTimer = setTimeout(() => { tick().catch(e => emitLog(`⚠️ tick异常: ${e.message}`)); }, ms);
        botInstance.timers = botInstance.timers || [];
        botInstance.timers.push(task._tickTimer);
    };

    function setState(s) { task.state = s; }

    async function tick() {
        if (!task.active || !bot.entity) return;
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
        return task.config.targets
            .map(name => mc.blocksByName[name] && mc.blocksByName[name].id)
            .filter(id => id !== undefined && id !== null);
    }

    function distSqTo(p) {
        const e = bot.entity.position;
        const dx = e.x - p.x, dy = e.y - p.y, dz = e.z - p.z;
        return dx * dx + dy * dy + dz * dz;
    }

    function emitStats() {
        const now = Date.now();
        if (now - task._lastStatsEmit < 500) return;
        task._lastStatsEmit = now;
        botInstance.io.to(botInstance._room).to('admin').emit('mine_stats', {
            user: bot.username, ownerId: botInstance.config.ownerId, stats: botInstance.getMineStats(),
        });
    }

    function nextFromQueueOrScan() {
        if (task.queue.length > 0) { setState('APPROACH'); schedule(H.actionInterval(task.config.humanize, 400)); }
        else { setState('SCAN'); schedule(H.actionInterval(task.config.humanize, 300)); }
    }

    function advanceTarget() {
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
            if (task.targetIds.length === 0) { emitLog('⚠️ 目标方块名无效，已停机'); return botInstance.stopAutoMine(); }
        }

        const positions = bot.findBlocks({ matching: task.targetIds, maxDistance: task.config.scanRadius, count: task.config.queueSize }) || [];
        if (positions.length === 0) { setState('ADVANCE'); return schedule(H.actionInterval(task.config.humanize, 500)); }

        task.queue = positions.slice().sort((a, b) => distSqTo(a) - distSqTo(b));
        setState('APPROACH');
        return schedule(H.aimDelay(task.config.humanize));
    }

    async function doApproach() {
        if (task.queue.length === 0) { setState('SCAN'); return schedule(200); }
        const idx = H.pickTargetIndex(task.queue.length, task.config.humanize);
        const pos = task.queue[idx];
        task._current = pos;
        task.queue.splice(idx, 1);
        try {
            await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2)); // 留余量，更像玩家
            task.approachFails = 0; // 成功到达，清零熔断计数
            setState('MINE');
            return schedule(H.aimDelay(task.config.humanize)); // 瞄准延迟
        } catch (e) {
            // 寻路失败熔断：连续够不到目标（隔墙/卡住）时不死循环，转 ADVANCE 换区域重扫
            task.approachFails++;
            if (task.approachFails >= (task.config.advance.maxFails || 5)) {
                task.approachFails = 0;
                task.queue = [];
                emitLog('⚠️ 连续无法到达目标矿，转移到新区域');
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
        // 装最佳工具；无合适工具则跳过告警（不空手硬挖）
        let tool = null;
        try { tool = bot.pathfinder.bestHarvestTool(block); if (tool) await bot.equip(tool, 'hand'); } catch (e) {}
        const canDig = typeof bot.canDigBlock === 'function' ? bot.canDigBlock(block) : true;
        if (!tool && !canDig) { emitLog(`⚠️ 无合适工具，跳过 ${block.name}`); return nextFromQueueOrScan(); }

        try {
            await bot.lookAt(pos.offset ? pos.offset(0.5, 0.5, 0.5) : { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 }, true);
            await bot.dig(block);
            const name = block.name;
            task.stats.minedByType[name] = (task.stats.minedByType[name] || 0) + 1;
            task.stats.total++;
            task.stats.lastMine = Date.now();
            emitStats();
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
            await bot.pathfinder.goto(new goals.GoalNear(t.x, t.y, t.z, 1));
            task.advanceFails = 0;
            setState('SCAN');
            return schedule(H.actionInterval(task.config.humanize, 400));
        } catch (e) {
            task.advanceFails++;
            if (task.advanceFails >= (task.config.advance.maxFails || 5)) {
                emitLog(`⚠️ 连续 ${task.advanceFails} 次无法推进，停机`);
                return botInstance.stopAutoMine();
            }
            setState('ADVANCE');
            return schedule(H.actionInterval(task.config.humanize, 1500));
        }
    }

    async function doPause() {
        if (task.waitingScript) return; // 正在等脚本，避免重入
        task.stats.fullEvents++;
        emitLog('📦 背包已满，执行清理策略...');

        // 1) 先丢垃圾
        const dropped = await dropTrashItems();
        if (dropped) await new Promise(r => setTimeout(r, 500)); // 等服务器同步背包，避免刚丢完仍读到满
        if (emptySlots() > 0) { setState('SCAN'); return schedule(H.actionInterval(task.config.humanize, 500)); }

        // 2) 仍满 → 回收脚本
        const sname = task.config.onFull.fallbackScript;
        const hasScript = sname && botInstance._scripts && botInstance._scripts[sname];
        if (hasScript && typeof botInstance.startScript === 'function') {
            if (botInstance._runningScript) { await waitScriptDone((task.config.onFull.scriptTimeout || 120) * 1000); }
            emitLog(`📦 调用回收脚本: ${sname}`);
            task.waitingScript = true;
            try { if (bot.pathfinder) bot.pathfinder.setGoal(null); } catch (e) {}
            botInstance.startScript(sname);
            const res = await waitScriptDone((task.config.onFull.scriptTimeout || 120) * 1000);
            task.waitingScript = false;
            if (res === 'timeout') { emitLog('⚠️ 回收脚本超时，停机'); return botInstance.stopAutoMine(); }
            if (!task.active) return;
            setState('SCAN');
            return schedule(H.actionInterval(task.config.humanize, 500));
        }

        // 3) 保底
        emitLog('⚠️ 背包满且无可用清理策略（无垃圾可丢/未配回收脚本），停机');
        return botInstance.stopAutoMine();
    }

    // ==================== 对外 API ====================
    botInstance.toggleAutoMine = (active, arg = [], direction = 'down') => {
        if (active) {
            task.config = normalizeConfig(arg, direction);
            task.targetIds = [];
            task.advanceFails = 0;
            task.waitingScript = false;
            task.stats = { minedByType: {}, total: 0, startTime: Date.now(), lastMine: null, fullEvents: 0 };
            task.active = true;
            setState('SCAN');

            // 保守 Movements：不开极限跑酷，更像玩家（best-effort，失败不影响）
            try {
                const m = new Movements(bot, getMcData());
                m.allowParkour = false;
                if (bot.pathfinder && bot.pathfinder.setMovements) bot.pathfinder.setMovements(m);
            } catch (e) {}

            botInstance.config.settings = botInstance.config.settings || {};
            botInstance.config.settings.autoMine = { active: true, config: task.config };
            if (typeof botInstance.saveConfig === 'function') botInstance.saveConfig();
            emitLog(`⛏️ 启动挖矿: ${task.config.targets.join(', ')} | 拟人:${task.config.humanize}`);
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
        return {
            minedByType: s.minedByType, total: s.total,
            runTime: Math.floor(runTime), rate: (s.total / Math.max(runTime, 1)).toFixed(2),
            lastMine: s.lastMine ? new Date(s.lastMine).toLocaleTimeString() : '从未', fullEvents: s.fullEvents,
        };
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
