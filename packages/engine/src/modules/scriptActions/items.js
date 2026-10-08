// 脚本动作：物品/背包类（equip/equip_best_weapon/equip_best_tool/deposit/drop/drop_all/use_item/swap_hands）
const { customName } = require('../../utils/items');

module.exports = {
    async equip(deps, step, _ctx) {
        // 关键词同时匹配「物品 id」与「自定义显示名」——RPG 服物品 id 多是 clock/paper，
        // 真正的「自助菜单」等名字在 NBT 显示名里，只按 id 匹配会找不到。
        const { bot, emitLog } = deps;
        const kw = String(step.item || '').toLowerCase();
        const item = bot.inventory.items().find(
            (i) => i.name.toLowerCase().includes(kw) || customName(i).toLowerCase().includes(kw),
        );
        if (!item) { emitLog(`没有: ${step.item}`); return; }
        emitLog(`持物: ${customName(item) || item.name}`);
        await bot.equip(item, step.dest || 'hand');
    },

    async equip_best_weapon(deps, _step, _ctx) {
        const { bot, botInstance, emitLog } = deps;
        const items = bot.inventory.items().filter((i) => /sword|axe/.test(i.name));
        if (items.length === 0) { emitLog('背包无武器'); return; }
        try {
            const mc = botInstance.getMcData();
            items.sort((a, b) => {
                const aDmg = mc.items[a.type]?.attackDamage || (a.name.includes('sword') ? 5 : 3);
                const bDmg = mc.items[b.type]?.attackDamage || (b.name.includes('sword') ? 5 : 3);
                return bDmg - aDmg;
            });
        } catch (_e) {
            items.sort((a, _b) => (a.name.includes('sword') ? -1 : 1));
        }
        emitLog(`装备最佳武器: ${items[0].name}`);
        await bot.equip(items[0], 'hand');
    },

    async equip_best_tool(deps, step, _ctx) {
        // 为「将要挖的方块」装备最合适的工具（镐/斧/锹…）。
        // 优先按关键词找最近的目标方块，没填关键词就用准星指向的方块；
        // 再用 pathfinder.bestHarvestTool 选最优工具（与 automine 同款写法）。
        const { bot, botInstance, emitLog } = deps;
        let block = null;
        const kw = String(step.block || step.item || '').toLowerCase();
        if (kw) {
            try {
                const mc = botInstance.getMcData();
                const ids = Object.values(mc.blocksByName || {})
                    .filter((b) => b.name.toLowerCase().includes(kw))
                    .map((b) => b.id);
                if (ids.length) {
                    const pos = bot.findBlock ? bot.findBlock({ matching: ids, maxDistance: 32 }) : null;
                    if (pos) block = pos;
                }
            } catch (_e) { /* 忽略，落到准星方块 */ }
        }
        if (!block && bot.blockAtCursor) block = bot.blockAtCursor(5);
        if (!block) { emitLog('没有可参照的方块（填方块名或先看向方块）'); return; }
        let tool = null;
        try { tool = bot.pathfinder.bestHarvestTool(block); } catch (_e) { /* 无可用工具 */ }
        if (tool) {
            emitLog(`为 ${block.name} 装备工具: ${tool.name}`);
            await bot.equip(tool, 'hand');
        } else {
            emitLog(`无需工具或背包没有合适工具（${block.name}）`);
        }
    },

    async deposit(deps, step, ctx) {
        // 把背包物品存入最近的箱子/容器（按名字关键词；留空=除装备外全部）。
        // 复用 window_gui 暴露的 scanContainers / openContainerAt（含寻路靠近 + 开窗），不写死坐标。
        // 可选 location：先去保存地点（走完整到达链，跨世界可用）再存箱——「去仓库存箱」一步到位。
        // 「给箱子命名」的玩法：站在箱子旁保存一个地点（如“仓库箱”），deposit 填该地点名——
        // 下面会取离地点坐标最近的容器，而不是离 bot 最近的，保证开的就是那一个箱子。
        const { bot, botInstance, emitLog, executeAction } = deps;
        let depositAnchor = null;
        if (step.location) {
            depositAnchor = (botInstance.savedLocations || []).find(
                (l) => l.name === step.location || l.id === step.location,
            ) || null;
            await executeAction({ do: 'goto_location', name: step.location, timeout: step.timeout }, ctx);
            if (ctx.aborted || !bot.entity) return;
        }
        const kw = String(step.item || '').toLowerCase();
        const containers = botInstance.scanContainers ? botInstance.scanContainers() : [];
        if (!containers.length) { emitLog('附近没有可用容器'); return; }
        let near = containers[0];
        if (depositAnchor) {
            const d2 = (c) => (c.x - depositAnchor.x) ** 2 + (c.y - depositAnchor.y) ** 2 + (c.z - depositAnchor.z) ** 2;
            near = containers.slice().sort((a, b) => d2(a) - d2(b))[0];
        }
        emitLog(`前往容器 (${near.x}, ${near.y}, ${near.z}) 存物`);
        try {
            // openContainerAt 内部寻路靠近并开窗；返回序列化快照，存物用 bot.currentWindow 这个活窗口
            await botInstance.openContainerAt(near.x, near.y, near.z);
        } catch (e) { emitLog(`打开容器失败: ${e.message}`); return; }
        if (ctx.aborted || !bot.entity) return; // 寻路/开窗期间断连
        const window = bot.currentWindow;
        if (!window) { emitLog('容器未打开'); return; }
        // 仅存玩家背包里的物品；按关键词过滤，留空则全部
        const toDeposit = bot.inventory.items().filter(
            (i) => !kw || i.name.toLowerCase().includes(kw) || customName(i).toLowerCase().includes(kw),
        );
        let n = 0;
        for (const item of toDeposit) {
            if (ctx.aborted || !bot.entity) break;
            try {
                await window.deposit(item.type, item.metadata, item.count);
                n++;
            } catch (e) { emitLog(`存入失败 ${item.name}: ${e.message}`); }
        }
        emitLog(`已存入 ${n} 种物品`);
        try { if (bot.currentWindow) await bot.closeWindow(bot.currentWindow); } catch (_e) { /* ignore */ }
    },

    async drop(deps, step, _ctx) {
        const { bot, emitLog } = deps;
        const itemName = String(step.item || '').toLowerCase();
        const item = bot.inventory.items().find((i) => i.name.toLowerCase().includes(itemName));
        if (!item) return;
        const count = Number(step.count) || item.count;
        emitLog(`丢弃: ${item.name} x${count}`);
        await bot.toss(item.type, item.metadata, count);
    },

    async drop_all(deps, step, ctx) {
        // 清空背包，保留关键词命中的物品（多个关键词用逗号/空格分隔；留空=全丢）。
        // 比单物品 drop 更实用：刷怪/挖矿满包时一键倒垃圾，保留工具/武器。
        const { bot, emitLog } = deps;
        const keepKws = String(step.keep || '')
            .toLowerCase().split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
        const isKept = (item) => keepKws.some(
            (k) => item.name.toLowerCase().includes(k) || customName(item).toLowerCase().includes(k),
        );
        const items = bot.inventory.items().filter((i) => !isKept(i));
        if (!items.length) { emitLog('没有可丢弃的物品'); return; }
        let n = 0;
        for (const item of items) {
            if (ctx.aborted || !bot.entity) break;
            try {
                await bot.toss(item.type, item.metadata, item.count);
                n++;
            } catch (_e) { /* 个别失败不阻塞 */ }
        }
        emitLog(`已丢弃 ${n} 种物品${keepKws.length ? `（保留: ${keepKws.join('/')}）` : ''}`);
    },

    async use_item(deps, step, ctx) {
        const { bot, emitLog } = deps;
        if (ctx.aborted || !bot.entity || bot.currentWindow || bot.health <= 0) return;
        if (step.expectedName && customName(bot.heldItem) !== step.expectedName) {
            emitLog('手持物已变化，跳过本次技能，避免误用其他物品');
            return;
        }
        emitLog('使用物品');
        bot.activateItem();
    },

    async swap_hands(deps, _step, _ctx) {
        const { bot, emitLog } = deps;
        emitLog('切换副手');
        if (bot.swapHandItems) await bot.swapHandItems();
    },
};
