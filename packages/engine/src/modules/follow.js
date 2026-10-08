// 跟随（类 Baritone follow）：盯住一个目标实体持续跟随，目标丢失自动重找。
// 匹配方式：
//   player         按玩家名（包含匹配，洗色码后比对——RPG 服名字常带称号色码）
//   keyword        按实体名/自定义名牌关键词（含头顶全息盔甲架名牌，和追怪同一套联想）
//   nearest_player 最近的玩家（谁近跟谁，对象会随距离变化切换）
// 用 pathfinder GoalFollow 动态跟随；目标丢失保持待命并周期重扫，不会乱跑。
module.exports = (botInstance) => {
    const bot = botInstance.bot;
    const { goals } = require('mineflayer-pathfinder');

    botInstance.followTask = botInstance.followTask || {
        active: false,
        config: { mode: 'nearest_player', target: '', distance: 3 },
        targetId: null,
        targetName: null,
        timer: null,
    };
    const task = botInstance.followTask;

    const emitLog = (msg) => botInstance.uiLog(msg);
    // 洗码/名牌解析/全息联想：共享实现见 utils/entityName.js（与追怪同一套）。
    // 相比旧本地版是纯升级：展平支持 1.20.3+ NBT {value} 形态与任意嵌套。
    const { stripMcCodes: stripCodes, entityDisplayName, isArmorStand, hologramNameFor } = require('../utils/entityName');
    const displayNameOf = (e) => entityDisplayName(e, '');

    const findTarget = () => {
        if (!bot.entity) return null;
        const { mode, target } = task.config;
        const myPos = bot.entity.position;
        const want = stripCodes(target || '').toLowerCase().trim();

        if (mode === 'nearest_player' || mode === 'player') {
            let best = null, bestD = Infinity;
            for (const e of Object.values(bot.entities)) {
                if (!e?.position || e.type !== 'player') continue;
                if (e.username === bot.username) continue;
                if (mode === 'player') {
                    const uname = stripCodes(e.username || '').toLowerCase();
                    const dname = displayNameOf(e).toLowerCase();
                    if (!want || (!uname.includes(want) && !dname.includes(want))) continue;
                }
                const d = myPos.distanceTo(e.position);
                if (d < bestD) { best = e; bestD = d; }
            }
            return best;
        }
        if (mode === 'keyword') {
            if (!want) return null;
            // 先收集全息名牌
            const stands = [];
            for (const e of Object.values(bot.entities)) {
                if (!e?.position || !isArmorStand(e)) continue;
                const nm = displayNameOf(e);
                if (nm && !/armor.?stand/i.test(nm)) stands.push({ pos: e.position, name: nm });
            }
            let best = null, bestD = Infinity;
            for (const e of Object.values(bot.entities)) {
                if (!e?.position || e === bot.entity) continue;
                if (isArmorStand(e)) continue;
                if (['object', 'orb', 'other'].includes(e.type)) continue;
                const own = displayNameOf(e).toLowerCase();
                let hit = own.includes(want);
                if (!hit) {
                    const holo = hologramNameFor(e, stands);
                    hit = !!holo && holo.toLowerCase().includes(want);
                }
                if (!hit) continue;
                const d = myPos.distanceTo(e.position);
                if (d < bestD) { best = e; bestD = d; }
            }
            return best;
        }
        return null;
    };

    // 运行统计：模块页展示当前跟随对象与实时距离（此前只有开关，跟丢了也看不出来）
    botInstance.getFollowStats = () => {
        const modeText = task.config.mode === 'player' ? `玩家 ${task.config.target}`
            : task.config.mode === 'keyword' ? `关键词 ${task.config.target}` : '最近的玩家';
        if (task.targetId != null) {
            const ent = bot.entities[task.targetId];
            const d = ent?.position && bot.entity ? bot.entity.position.distanceTo(ent.position) : null;
            return {
                activity: `跟随 ${task.targetName}${d != null ? `（${d.toFixed(1)} 格）` : ''}`,
                target: task.targetName,
            };
        }
        return { activity: `未找到目标（${modeText}），待命中…`, target: '—' };
    };

    let lostSince = 0;
    let lastLostLogAt = 0;
    const tick = () => {
        if (!task.active || !bot.entity) return;
        try {
            const ent = task.targetId != null ? bot.entities[task.targetId] : null;
            const fresh = (ent?.position) ? (task.config.mode === 'nearest_player' ? findTarget() : ent) : findTarget();
            if (fresh?.position) {
                lostSince = 0;
                if (fresh.id !== task.targetId) {
                    task.targetId = fresh.id;
                    task.targetName = fresh.username || displayNameOf(fresh) || String(fresh.id);
                    const dist = Math.max(1, Number(task.config.distance) || 3);
                    bot.pathfinder.setGoal(new goals.GoalFollow(fresh, dist), true);
                    emitLog(`跟随目标: ${task.targetName}`);
                }
            } else {
                if (task.targetId != null) {
                    task.targetId = null;
                    try { bot.pathfinder.setGoal(null); } catch (_e) { /* ignore */ }
                }
                if (!lostSince) lostSince = Date.now();
                // 丢失提示限流：每 15s 一条，避免刷日志
                if (Date.now() - lastLostLogAt > 15000) {
                    lastLostLogAt = Date.now();
                    emitLog(`跟随：未找到目标（${task.config.mode === 'player' ? `玩家 ${task.config.target}` : task.config.mode === 'keyword' ? `关键词 ${task.config.target}` : '附近无玩家'}），待命中…`);
                }
            }
        } catch (_e) { /* 单拍异常不终止跟随 */ }
    };

    botInstance.toggleFollow = (active, config) => {
        if (active) {
            const c = config || {};
            task.config = {
                mode: ['player', 'keyword', 'nearest_player'].includes(c.mode) ? c.mode : 'nearest_player',
                target: typeof c.target === 'string' ? c.target : (Array.isArray(c.target) ? c.target.join(',') : ''),
                distance: Math.max(1, Math.min(10, Number(c.distance) || 3)),
            };
            // tags 字段会传数组；多关键词取第一个非空（跟随一次只盯一个对象）
            if (Array.isArray(c.target)) task.config.target = String(c.target.find(Boolean) || '');
            task.active = true;
            task.targetId = null;
            task.targetName = null;
            if (task.timer) {
                clearInterval(task.timer);
                // 同步从实例 timers 数组移除旧句柄（MODA-2 同款）：只 clear 不 splice 的话，
                // 脚本/自动化频繁切换跟随目标的长跑场景下数组无界堆积
                const i = botInstance.timers.indexOf(task.timer);
                if (i >= 0) botInstance.timers.splice(i, 1);
            }
            task.timer = setInterval(tick, 800);
            botInstance.timers.push(task.timer);
            emitLog(`跟随已开启（${task.config.mode === 'player' ? `玩家: ${task.config.target}` : task.config.mode === 'keyword' ? `关键词: ${task.config.target}` : '最近的玩家'}，距离 ${task.config.distance}）`);
            tick();
        } else {
            task.active = false;
            task.targetId = null;
            task.targetName = null;
            if (task.timer) { clearInterval(task.timer); task.timer = null; }
            try { bot.pathfinder.setGoal(null); } catch (_e) { /* ignore */ }
            emitLog('跟随已停止');
        }
    };

    botInstance.cleanupHooks.push(() => {
        if (task.timer) { clearInterval(task.timer); task.timer = null; }
        task.active = false;
        task.targetId = null;
    });
};
