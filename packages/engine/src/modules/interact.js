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
            return '';
        }
        return String(v);
    };

    // 返回附近实体数组（供交互页内联显示，不再刷日志）
    botInstance.scanNearbyNPCs = () => {
        if (!bot || !bot.entities || !bot.entity) return [];
        if (!mcData) mcData = require('minecraft-data')(bot.version);

        const out = [];
        for (const entity of Object.values(bot.entities)) {
            if (entity === bot.entity) continue;
            if (['object', 'item', 'xp_orb', 'orb'].includes(entity.type)) continue;
            const dist = bot.entity.position.distanceTo(entity.position);
            if (dist >= 32) continue;

            let typeName = entity.name || entity.type;
            if (!isNaN(typeName)) typeName = mcData.entities[typeName]?.name || `id_${typeName}`;
            // 自定义名牌/玩家名：保留颜色码（nameRaw）供前端彩色渲染，name 为去色纯文本
            const src = entity.customName || entity.username || "";
            const nameRaw = nameMotd(src).trim();
            const name = nameRaw.replace(/§[0-9a-fk-orx]/gi, '').trim();

            out.push({
                id: entity.id,
                type: typeName,
                name: name || null,
                nameRaw: nameRaw || null,
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

            await bot.pathfinder.goto(new goals.GoalFollow(target, 2)); // 稍微拉开距离防止挤压NPC
            await bot.lookAt(target.position.offset(0, target.height * 0.8, 0), true);

            bot.swingArm('right');
            if (bot.activateEntityAt) {
                await bot.activateEntityAt(target, new Vec3(0, 1, 0));
            } else {
                await bot.activateEntity(target);
            }
            botInstance.io.to(botInstance._room).to('admin').emit('log', {
                user: bot.username,
                ownerId: botInstance.config.ownerId,
                msg: `交互指令已送达 (TargetID: ${target.id})`
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
