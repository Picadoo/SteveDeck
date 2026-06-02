const Vec3 = require('vec3');

module.exports = (botInstance) => {
    const bot = botInstance.bot;
    let mcData = null;

    botInstance.scanNearbyNPCs = () => {
        if (!bot || !bot.entities) return;
        if (!mcData) mcData = require('minecraft-data')(bot.version); // 缓存数据

        const entities = Object.values(bot.entities);
        let foundCount = 0;

        entities.forEach(entity => {
            if (entity === bot.entity) return;
            if (['object', 'item', 'xp_orb'].includes(entity.type)) return;

            const dist = bot.entity.position.distanceTo(entity.position);
            if (dist < 32) {
                let typeName = entity.name || entity.type;
                // 修复逻辑：不再频繁查找庞大的数组，提升扫描速度
                if (!isNaN(typeName)) {
                    typeName = mcData.entities[typeName]?.name || `id_${typeName}`;
                }

                let rawName = entity.customName || entity.username || "";
                let cleanName = rawName.toString().replace(/§[0-9a-fk-orx]/gi, '').trim();

                botInstance.io.to(botInstance._room).to('admin').emit('log', {
                    user: bot.username,
                    ownerId: botInstance.config.ownerId,
                    msg: `>> [${typeName}] ${cleanName || "[未命名]"} | 距离: ${Math.round(dist)}m | ID: ${entity.id}`,
                    time: new Date().toLocaleTimeString()
                });
                foundCount++;
            }
        });

        if (foundCount === 0) {
            botInstance.io.to(botInstance._room).to('admin').emit('log', {
                user: bot.username,
                ownerId: botInstance.config.ownerId,
                msg: "📡 [雷达] 32格内空空如也。"
            });
        }
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
                msg: `❌ 未找到目标: "${input}"`
            });
            return;
        }

        try {
            const { goals } = require('mineflayer-pathfinder');
            botInstance.io.to(botInstance._room).to('admin').emit('log', {
                user: bot.username,
                ownerId: botInstance.config.ownerId,
                msg: `🚀 正在同步坐标并靠近...`
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
                msg: `🤝 交互指令已送达 (TargetID: ${target.id})`
            });
        } catch (err) {
            botInstance.io.to(botInstance._room).to('admin').emit('log', {
                user: bot.username,
                ownerId: botInstance.config.ownerId,
                msg: `⚠️ 交互失败: ${err.message}`
            });
        }
    };
};
