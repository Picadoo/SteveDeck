const Vec3 = require('vec3');

module.exports = (botInstance) => {
    const bot = botInstance.bot;
    let mcData = null;

    // 取带颜色的名字（兼容 ChatMessage / 字符串）
    const nameMotd = (v) => {
        if (v == null) return '';
        if (typeof v === 'object') {
            try { if (typeof v.toMotd === 'function') return v.toMotd(); } catch (e) { /* ignore */ }
            try { const s = v.toString(); if (s && s !== '[object Object]') return s; } catch (e) { /* ignore */ }
            // JSON 聊天组件 {text, extra}
            if (typeof v.text === 'string' || Array.isArray(v.extra)) {
                const flat = (v.text || '') +
                    (Array.isArray(v.extra) ? v.extra.map(e => (typeof e === 'string' ? e : (e && e.text) || '')).join('') : '');
                if (flat) return flat;
            }
            return '';
        }
        return String(v);
    };

    // 返回附近实体数组（供交互页内联显示，不再刷日志）
    botInstance.scanNearbyNPCs = () => {
        if (!bot || !bot.entities || !bot.entity) return [];
        if (!mcData) mcData = botInstance.getMcData();

        const out = [];
        for (const entity of Object.values(bot.entities)) {
            if (entity === bot.entity) continue;
            if (['object', 'item', 'xp_orb', 'orb'].includes(entity.type)) continue;
            const dist = bot.entity.position.distanceTo(entity.position);
            if (dist >= 32) continue;

            let typeName = entity.name || entity.type;
            if (!isNaN(typeName)) typeName = mcData.entities[typeName]?.name || `id_${typeName}`;
            // 自定义名牌：1.12.2 名牌在 metadata[2]（mineflayer 不一定填 customName），其次 customName，最后玩家名。
            // 保留颜色码（nameRaw）供前端彩色渲染，name 为去色纯文本。
            let src = entity.customName;
            if (src == null && entity.metadata) src = entity.metadata[2];
            const nameRaw = (src != null ? nameMotd(src) : (entity.username || "")).trim();
            const name = nameRaw.replace(/§[0-9a-fk-orx]/gi, '').trim();

            // 区分「真实在线玩家」与「NPC（多为伪装成玩家的 Citizens 实体）」
            const realPlayer = entity.type === 'player' && !!(bot.players && bot.players[entity.username]);

            out.push({
                id: entity.id,
                type: typeName,
                name: name || null,
                nameRaw: nameRaw || null,
                realPlayer,
                distance: Math.round(dist * 10) / 10,
            });
        }
        out.sort((a, b) => a.distance - b.distance);
        return out;
    };

    botInstance.interactWithNPC = async (input) => {
        const target = bot.nearestEntity((entity) => {
            if (entity === bot.entity) return false;
            let name = (entity.customName || entity.username || "").replace(/§[0-9a-fk-orx]/gi, '').toLowerCase();
            return name.includes(input.toLowerCase()) || entity.id.toString() === input;
        });

        if (!target) {
            botInstance.io.to(botInstance._room).to('admin').emit('log', {
                user: bot.username,
                ownerId: botInstance.config.ownerId,
                msg: `未找到目标: "${input}"`
            });
            return;
        }

        try {
            const { goals } = require('mineflayer-pathfinder');
            botInstance.io.to(botInstance._room).to('admin').emit('log', {
                user: bot.username,
                ownerId: botInstance.config.ownerId,
                msg: `正在同步坐标并靠近...`
            });

            // GoalNear 会结束（GoalFollow 是持续跟随、不收敛），靠近到约 2.5 格
            await bot.pathfinder.goto(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2.5));
            try { bot.pathfinder.setGoal(null); } catch (e) { /* 停下，别再推进 */ }

            // 命中点取实体中心；模拟真实客户端右键：先 interact_at(mouse:2) 再 interact(mouse:0)
            const at = target.position.offset(0, (target.height || 1.8) / 2, 0);
            await bot.lookAt(at, true);
            bot.swingArm('right');
            try { await bot.activateEntityAt(target, at); } catch (e) { /* 部分服不支持 at，忽略 */ }
            try { await bot.activateEntity(target); } catch (e) { /* 忽略 */ }

            botInstance.io.to(botInstance._room).to('admin').emit('log', {
                user: bot.username,
                ownerId: botInstance.config.ownerId,
                msg: `已右键交互: ${nameMotd(target.customName).replace(/§[0-9a-fk-orx]/gi, '').trim() || target.username || target.name || target.id}`
            });
        } catch (err) {
            botInstance.io.to(botInstance._room).to('admin').emit('log', {
                user: bot.username,
                ownerId: botInstance.config.ownerId,
                msg: `交互失败: ${err.message}`
            });
        }
    };
};
