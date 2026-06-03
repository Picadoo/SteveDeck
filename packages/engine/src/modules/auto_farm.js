const Vec3 = require('vec3');

module.exports = (botInstance) => {
    const bot = botInstance.bot;
    const { goals, Movements } = require('mineflayer-pathfinder');

    const CROP_DATABASE = {
        wheat: { name: '小麦', matureAge: 7, seedName: 'wheat_seeds', dropName: 'wheat', canUseBoneMeal: true },
        carrots: { name: '胡萝卜', matureAge: 7, seedName: 'carrot', dropName: 'carrot', canUseBoneMeal: true },
        potatoes: { name: '土豆', matureAge: 7, seedName: 'potato', dropName: 'potato', canUseBoneMeal: true },
        beetroots: { name: '甜菜根', matureAge: 3, seedName: 'beetroot_seeds', dropName: 'beetroot', canUseBoneMeal: true },
        pumpkin: { name: '南瓜', matureAge: -1, seedName: 'pumpkin_seeds', dropName: 'pumpkin', canUseBoneMeal: false, isStemCrop: true },
        melon: { name: '西瓜', matureAge: -1, seedName: 'melon_seeds', dropName: 'melon', canUseBoneMeal: false, isStemCrop: true }
    };

    botInstance.farmTask = {
        active: false,
        cropTypes: ['wheat'],
        scanRadius: 32,
        useBoneMeal: false,
        autoReplant: true,
        sortInventory: false, // 默认关闭，堆叠逻辑不可靠
        timer: null,
        _isRunning: false, // 防止循环重入
        stats: { harvested: {}, planted: {}, boneMealUsed: 0, startTime: null, lastHarvest: null }
    };

    const emitLog = (msg) => {
        botInstance.io.to(botInstance._room).to('admin').emit('log', {
            user: bot.username, ownerId: botInstance.config.ownerId,
            msg, time: new Date().toLocaleTimeString()
        });
    };

    const isMatureCrop = (block, cropType) => {
        const cropInfo = CROP_DATABASE[cropType];
        if (!cropInfo) return false;
        if (cropInfo.isStemCrop) return block.name === cropInfo.dropName;
        if (block.name !== cropType) return false;
        try {
            const props = block.getProperties ? block.getProperties() : {};
            const age = props.age !== undefined ? props.age : block.metadata;
            return age === cropInfo.matureAge;
        } catch (err) {
            return block.metadata === cropInfo.matureAge;
        }
    };

    // 合并扫描：一次遍历匹配所有作物类型
    const findAllMatureCrops = () => {
        const types = botInstance.farmTask.cropTypes;
        const allCrops = [];

        const positions = bot.findBlocks({
            matching: (block) => {
                for (const cropType of types) {
                    if (isMatureCrop(block, cropType)) return true;
                }
                return false;
            },
            maxDistance: botInstance.farmTask.scanRadius,
            count: 64
        });

        positions.forEach(pos => {
            const block = bot.blockAt(pos);
            if (!block) return;
            for (const cropType of types) {
                if (isMatureCrop(block, cropType)) {
                    allCrops.push({ position: pos, cropType });
                    break;
                }
            }
        });

        return allCrops;
    };

    const harvestCrop = async (position, cropType) => {
        try {
            const block = bot.blockAt(position);
            if (!block || !isMatureCrop(block, cropType)) return false;

            // 只用 goto，不要同时调 setGoal
            const goal = new goals.GoalNear(position.x, position.y, position.z, 4);
            await bot.pathfinder.goto(goal);

            // 到达后重新获取方块（可能已被其他玩家收割）
            const currentBlock = bot.blockAt(position);
            if (!currentBlock || !isMatureCrop(currentBlock, cropType)) return false;

            await bot.dig(currentBlock);

            if (!botInstance.farmTask.stats.harvested[cropType]) {
                botInstance.farmTask.stats.harvested[cropType] = 0;
            }
            botInstance.farmTask.stats.harvested[cropType]++;
            botInstance.farmTask.stats.lastHarvest = new Date();

            const total = Object.values(botInstance.farmTask.stats.harvested).reduce((a, b) => a + b, 0);
            emitLog(`收割 ${CROP_DATABASE[cropType].name} (${position.x}, ${position.y}, ${position.z}) [总计: ${total}]`);
            return true;
        } catch (err) {
            // 寻路失败或挖掘失败，跳过这个作物
            return false;
        }
    };

    const replantCrop = async (position, cropType) => {
        if (!botInstance.farmTask.autoReplant) return false;
        try {
            const cropInfo = CROP_DATABASE[cropType];
            if (cropInfo.isStemCrop) return false; // 南瓜西瓜不需要补种

            // 查找种子
            let seedItem = bot.inventory.items().find(item => item.name === cropInfo.seedName);

            // 胡萝卜/土豆可以用作物本身种
            if (!seedItem && (cropType === 'carrots' || cropType === 'potatoes')) {
                seedItem = bot.inventory.items().find(item => item.name === cropInfo.dropName);
            }
            if (!seedItem) return false;

            await bot.equip(seedItem, 'hand');
            await new Promise(resolve => setTimeout(resolve, 150));

            const farmlandBlock = bot.blockAt(position.offset(0, -1, 0));
            if (!farmlandBlock || !farmlandBlock.name.includes('farmland')) return false;

            await bot.placeBlock(farmlandBlock, new Vec3(0, 1, 0));

            if (!botInstance.farmTask.stats.planted[cropType]) {
                botInstance.farmTask.stats.planted[cropType] = 0;
            }
            botInstance.farmTask.stats.planted[cropType]++;
            return true;
        } catch (err) {
            return false;
        }
    };

    const useBoneMeal = async (position, cropType) => {
        if (!botInstance.farmTask.useBoneMeal) return false;
        const cropInfo = CROP_DATABASE[cropType];
        if (!cropInfo || !cropInfo.canUseBoneMeal) return false;
        try {
            const boneMeal = bot.inventory.items().find(item =>
                item.name === 'bone_meal' || item.name === 'dye' && item.metadata === 15 // 1.12.2 兼容
            );
            if (!boneMeal) return false;
            await bot.equip(boneMeal, 'hand');
            const block = bot.blockAt(position);
            if (!block) return false;
            await bot.activateBlock(block);
            botInstance.farmTask.stats.boneMealUsed++;
            return true;
        } catch (err) {
            return false;
        }
    };

    const boneMealImmatureCrops = async (cropType) => {
        if (!botInstance.farmTask.useBoneMeal) return;
        const cropInfo = CROP_DATABASE[cropType];
        if (!cropInfo || !cropInfo.canUseBoneMeal) return;

        const immatureCrops = bot.findBlocks({
            matching: (block) => {
                if (block.name !== cropType) return false;
                try {
                    const props = block.getProperties ? block.getProperties() : {};
                    const age = props.age !== undefined ? props.age : block.metadata;
                    return age < cropInfo.matureAge;
                } catch (err) { return false; }
            },
            maxDistance: botInstance.farmTask.scanRadius,
            count: 10
        });

        for (const pos of immatureCrops) {
            if (!botInstance.farmTask.active) break;
            await useBoneMeal(pos, cropType);
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    };

    const farmCycle = async () => {
        if (!botInstance.farmTask.active || !bot.entity) return;
        if (botInstance.farmTask._isRunning) return; // 防止重入
        botInstance.farmTask._isRunning = true;

        try {
            const allMatureCrops = findAllMatureCrops();

            if (allMatureCrops.length > 0) {
                const cropCounts = {};
                allMatureCrops.forEach(crop => {
                    cropCounts[crop.cropType] = (cropCounts[crop.cropType] || 0) + 1;
                });
                const cropList = Object.entries(cropCounts)
                    .map(([type, count]) => `${CROP_DATABASE[type].name}×${count}`)
                    .join(', ');
                emitLog(`发现 ${allMatureCrops.length} 个成熟作物: ${cropList}`);

                for (const crop of allMatureCrops) {
                    if (!botInstance.farmTask.active) break;

                    const harvested = await harvestCrop(crop.position, crop.cropType);
                    if (harvested) {
                        await new Promise(resolve => setTimeout(resolve, 400));
                        await replantCrop(crop.position, crop.cropType);
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                }
            }

            if (botInstance.farmTask.useBoneMeal && botInstance.farmTask.active) {
                for (const cropType of botInstance.farmTask.cropTypes) {
                    if (!botInstance.farmTask.active) break;
                    await boneMealImmatureCrops(cropType);
                }
            }
        } catch (err) {
            emitLog(`农场出错: ${err.message}`);
        } finally {
            botInstance.farmTask._isRunning = false;
        }
    };

    botInstance.getFarmStats = () => {
        const stats = botInstance.farmTask.stats;
        if (!stats.startTime) return null;
        const runTime = (Date.now() - stats.startTime) / 1000 / 60;
        const totalHarvested = Object.values(stats.harvested).reduce((a, b) => a + b, 0);
        const totalPlanted = Object.values(stats.planted).reduce((a, b) => a + b, 0);
        return {
            cropTypes: botInstance.farmTask.cropTypes.map(t => CROP_DATABASE[t]?.name || t).join(', '),
            harvestedByType: stats.harvested,
            plantedByType: stats.planted,
            totalHarvested, totalPlanted,
            boneMealUsed: stats.boneMealUsed,
            runTime: Math.floor(runTime),
            harvestRate: (totalHarvested / Math.max(runTime, 1)).toFixed(2),
            lastHarvest: stats.lastHarvest ? stats.lastHarvest.toLocaleTimeString() : '从未'
        };
    };

    botInstance.toggleAutoFarm = (active, config = {}) => {
        botInstance.farmTask.active = active;

        if (config.cropTypes && Array.isArray(config.cropTypes)) {
            botInstance.farmTask.cropTypes = config.cropTypes;
        } else if (config.cropType) {
            botInstance.farmTask.cropTypes = [config.cropType];
        }
        if (config.scanRadius !== undefined) botInstance.farmTask.scanRadius = config.scanRadius;
        if (config.useBoneMeal !== undefined) botInstance.farmTask.useBoneMeal = config.useBoneMeal;
        if (config.autoReplant !== undefined) botInstance.farmTask.autoReplant = config.autoReplant;

        if (active) {
            botInstance.farmTask.stats = { harvested: {}, planted: {}, boneMealUsed: 0, startTime: Date.now(), lastHarvest: null };
            botInstance.farmTask._isRunning = false;

            const cropNames = botInstance.farmTask.cropTypes.map(t => CROP_DATABASE[t]?.name || t).join('、');
            emitLog(`启动自动农场\n  作物: ${cropNames}\n  扫描半径: ${botInstance.farmTask.scanRadius}格\n  自动补种: ${botInstance.farmTask.autoReplant ? '是' : '否'}\n  使用骨粉: ${botInstance.farmTask.useBoneMeal ? '是' : '否'}`);

            if (botInstance.farmTask.timer) clearInterval(botInstance.farmTask.timer);
            botInstance.farmTask.timer = setInterval(farmCycle, 20000);
            farmCycle();

            botInstance.timers = botInstance.timers || [];
            botInstance.timers.push(botInstance.farmTask.timer);
        } else {
            if (botInstance.farmTask.timer) {
                clearInterval(botInstance.farmTask.timer);
                botInstance.farmTask.timer = null;
            }

            const stats = botInstance.getFarmStats();
            if (stats) {
                let detail = '';
                for (const [ct, count] of Object.entries(stats.harvestedByType)) {
                    detail += `    ${CROP_DATABASE[ct]?.name || ct}: 收割${count}个, 种植${stats.plantedByType[ct] || 0}个\n`;
                }
                emitLog(`农场统计\n  运行: ${stats.runTime}分钟\n  总收割: ${stats.totalHarvested}个\n  总种植: ${stats.totalPlanted}个\n${detail}  骨粉: ${stats.boneMealUsed}个\n  效率: ${stats.harvestRate}个/分钟`);
            }
            emitLog(`自动农场已关闭`);
        }
    };

    botInstance.scanFarmland = () => {
        const farmlandBlocks = bot.findBlocks({
            matching: (block) => block.name.includes('farmland'),
            maxDistance: botInstance.farmTask.scanRadius,
            count: 999
        });

        if (farmlandBlocks.length === 0) {
            emitLog(`附近没有发现耕地`);
            return null;
        }

        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, avgY = 0;
        farmlandBlocks.forEach(pos => {
            minX = Math.min(minX, pos.x); maxX = Math.max(maxX, pos.x);
            minZ = Math.min(minZ, pos.z); maxZ = Math.max(maxZ, pos.z);
            avgY += pos.y;
        });
        avgY = Math.floor(avgY / farmlandBlocks.length);

        emitLog(`扫描到农田\n  数量: ${farmlandBlocks.length}块\n  范围: (${minX}, ${avgY}, ${minZ}) 到 (${maxX}, ${avgY}, ${maxZ})\n  面积: ${(maxX - minX + 1) * (maxZ - minZ + 1)}格`);
        return { count: farmlandBlocks.length, area: { x1: minX, z1: minZ, x2: maxX, z2: maxZ, y: avgY } };
    };

    botInstance.cleanupHooks = botInstance.cleanupHooks || [];
    botInstance.cleanupHooks.push(() => {
        botInstance.farmTask.active = false;
        if (botInstance.farmTask.timer) {
            clearInterval(botInstance.farmTask.timer);
            botInstance.farmTask.timer = null;
        }
        try { if (bot.pathfinder) bot.pathfinder.setGoal(null); } catch (e) {}
    });
};
