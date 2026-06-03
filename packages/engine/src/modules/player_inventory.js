const { enchantNames, customName } = require('../utils/items');

module.exports = (botInstance) => {
    const bot = botInstance.bot;

    // 物品动态日志（操作类，不带 chat 标记）
    const emitItem = (msg) =>
        botInstance.io.to(botInstance._room).to('admin').emit('log', {
            user: bot.username,
            ownerId: botInstance.config.ownerId,
            msg,
            time: new Date().toLocaleTimeString(),
        });

    // 对比全槽位总量，记录净增减：捡到/获得装备(+)、存箱/丢弃/用掉(-)
    const trackItemFlow = () => {
        try {
            const totals = {};
            for (const it of bot.inventory.slots) {
                if (!it) continue;
                const key = customName(it) || it.displayName || it.name;
                totals[key] = (totals[key] || 0) + it.count;
            }
            const prev = botInstance._itemTotals;
            if (prev) {
                for (const k of new Set([...Object.keys(totals), ...Object.keys(prev)])) {
                    const d = (totals[k] || 0) - (prev[k] || 0);
                    if (d > 0) emitItem(`获得 ${k} ×${d}`);
                    else if (d < 0) emitItem(`失去 ${k} ×${-d}`);
                }
            }
            botInstance._itemTotals = totals;
        } catch (e) {
            /* ignore */
        }
    };

    // 封装同步函数
    const syncInventory = () => {
        if (!bot || !bot.inventory) return;

        const items = bot.inventory.slots.map((item, index) => {
            if (!item) return { slot: index, name: null };

            // 深度解析 NBT 获取 Lore 和名字
            let customName = item.displayName;
            let loreLines = [];
            if (item.nbt && item.nbt.value && item.nbt.value.display) {
                const display = item.nbt.value.display.value;
                if (display.Name) customName = display.Name.value;
                if (display.Lore) loreLines = display.Lore.value.value;
            }

            return {
                slot: index,
                name: customName.replace(/§[0-9a-fk-orx]/gi, ''),
                lore: loreLines.map(l => l.replace(/§[0-9a-fk-orx]/gi, '')).join('\n'),
                count: item.count,
                texture: item.name, // 原始物品 id
                enchants: enchantNames(item)
            };
        });

        botInstance.io.to(botInstance._room).to('admin').emit('player_inv_data', {
            user: bot.username,
            ownerId: botInstance.config.ownerId,
            items: items
        });

        trackItemFlow();
    };

    // 挂载到实例上供外部调用
    botInstance.syncInventory = syncInventory;

    // 背包交互：丢弃 / 装备 / 使用（按槽位）
    const armorDest = (name) => {
        if (/helmet/.test(name)) return 'head';
        if (/chestplate|elytra/.test(name)) return 'torso';
        if (/leggings/.test(name)) return 'legs';
        if (/boots/.test(name)) return 'feet';
        return null;
    };
    botInstance.dropSlot = async (slot) => {
        const it = bot.inventory.slots[slot];
        if (!it) throw new Error('该格为空');
        await bot.tossStack(it);
        syncInventory();
    };
    botInstance.equipSlot = async (slot) => {
        const it = bot.inventory.slots[slot];
        if (!it) throw new Error('该格为空');
        await bot.equip(it, armorDest(it.name) || 'hand');
        syncInventory();
    };
    botInstance.useSlot = async (slot) => {
        const it = bot.inventory.slots[slot];
        if (!it) throw new Error('该格为空');
        await bot.equip(it, 'hand');
        bot.activateItem();
        setTimeout(() => {
            try { bot.deactivateItem(); } catch (e) { /* ignore */ }
            syncInventory();
        }, 400);
    };

    // 事件驱动同步加防抖：挖矿/战斗时槽位会连续变动，合并 150ms 内的多次事件为一次全量解析+推送
    let syncDebounceTimer = null;
    const scheduleSync = () => {
        if (syncDebounceTimer) return; // 已排程，本轮事件合并
        syncDebounceTimer = setTimeout(() => {
            syncDebounceTimer = null;
            syncInventory();
        }, 150);
    };

    bot.on('playerCollect', scheduleSync);
    bot.inventory.on('updateSlot', scheduleSync);

    // 每 10 秒强制全量同步一次，防止漏包
    botInstance.timers = botInstance.timers || [];
    const inventoryTimer = setInterval(syncInventory, 10000);
    botInstance.timers.push(inventoryTimer);

    // 添加清理钩子（包含事件监听器清理）
    botInstance.cleanupHooks = botInstance.cleanupHooks || [];
    botInstance.cleanupHooks.push(() => {
        clearInterval(inventoryTimer);
        if (syncDebounceTimer) { clearTimeout(syncDebounceTimer); syncDebounceTimer = null; }
        bot.removeListener('playerCollect', scheduleSync);
        if (bot.inventory) {
            bot.inventory.removeListener('updateSlot', scheduleSync);
        }
    });
};