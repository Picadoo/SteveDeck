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

    const emitLog = (msg) => {
        botInstance.io.to(botInstance._room).to('admin').emit('log', {
            user: bot.username, ownerId: botInstance.config.ownerId,
            msg, time: new Date().toLocaleTimeString()
        });
    };
    const stripCodes = (s) => String(s == null ? '' : s).replace(/§./g, '');

    // 实体显示名：metadata 名牌（字符串/JSON 组件）→ customName/displayName/类型名
    const displayNameOf = (e) => {
        if (!e) return '';
        try {
            const cn = e.metadata && e.metadata[2];
            if (typeof cn === 'string' && cn) return stripCodes(cn).trim();
            if (cn && typeof cn === 'object') {
                const flat = (cn.text || '') +
                    (Array.isArray(cn.extra) ? cn.extra.map(x => (typeof x === 'string' ? x : (x && x.text) || '')).join('') : '');
                if (flat) return stripCodes(flat).trim();
            }
        } catch (err) { /* ignore */ }
        return stripCodes(e.customName || e.displayName || e.name || '').trim();
    };
    const isArmorStand = (e) => e && /armor.?stand/i.test(String(e.name || e.kind || ''));

    // 全息名牌联想（与追怪同思路）：名字挂在头顶隐形盔甲架上时，按名牌匹配本体
    const hologramNameFor = (entity, stands) => {
        for (const h of stands) {
            const dx = h.pos.x - entity.position.x;
            const dz = h.pos.z - entity.position.z;
            const dy = h.pos.y - entity.position.y;
            if (dx * dx + dz * dz <= 1.6 * 1.6 && dy > -0.5 && dy < 3.2) return h.name;
        }
        return null;
    };

    const findTarget = () => {
        if (!bot.entity) return null;
        const { mode, target } = task.config;
        const myPos = bot.entity.position;
        const want = stripCodes(target || '').toLowerCase().trim();

        if (mode === 'nearest_player' || mode === 'player') {
            let best = null, bestD = Infinity;
            for (const e of Object.values(bot.entities)) {
                if (!e || !e.position || e.type !== 'player') continue;
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
                if (!e || !e.position || !isArmorStand(e)) continue;
                const nm = displayNameOf(e);
                if (nm && !/armor.?stand/i.test(nm)) stands.push({ pos: e.position, name: nm });
            }
            let best = null, bestD = Infinity;
            for (const e of Object.values(bot.entities)) {
                if (!e || !e.position || e === bot.entity) continue;
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

    let lostSince = 0;
    let lastLostLogAt = 0;
    const tick = () => {
        if (!task.active || !bot.entity) return;
        try {
            const ent = task.targetId != null ? bot.entities[task.targetId] : null;
            const fresh = (ent && ent.position) ? (task.config.mode === 'nearest_player' ? findTarget() : ent) : findTarget();
            if (fresh && fresh.position) {
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
                    try { bot.pathfinder.setGoal(null); } catch (e) { /* ignore */ }
                }
                if (!lostSince) lostSince = Date.now();
                // 丢失提示限流：每 15s 一条，避免刷日志
                if (Date.now() - lastLostLogAt > 15000) {
                    lastLostLogAt = Date.now();
                    emitLog(`跟随：未找到目标（${task.config.mode === 'player' ? '玩家 ' + task.config.target : task.config.mode === 'keyword' ? '关键词 ' + task.config.target : '附近无玩家'}），待命中…`);
                }
            }
        } catch (e) { /* 单拍异常不终止跟随 */ }
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
            if (task.timer) clearInterval(task.timer);
            task.timer = setInterval(tick, 800);
            botInstance.timers.push(task.timer);
            emitLog(`跟随已开启（${task.config.mode === 'player' ? '玩家: ' + task.config.target : task.config.mode === 'keyword' ? '关键词: ' + task.config.target : '最近的玩家'}，距离 ${task.config.distance}）`);
            tick();
        } else {
            task.active = false;
            task.targetId = null;
            task.targetName = null;
            if (task.timer) { clearInterval(task.timer); task.timer = null; }
            try { bot.pathfinder.setGoal(null); } catch (e) { /* ignore */ }
            emitLog('跟随已停止');
        }
    };

    botInstance.cleanupHooks.push(() => {
        if (task.timer) { clearInterval(task.timer); task.timer = null; }
        task.active = false;
        task.targetId = null;
    });
};
