// 脚本动作：世界交互类（attack/dig/place/craft）
const { Vec3 } = require('vec3');
const { customName } = require('../../utils/items');

module.exports = {
    async attack(deps, step, ctx) {
        const { bot, emitLog, sleep } = deps;
        const targetName = step.target || step.entity; // 积木字段名为 entity
        const count = Math.max(1, Number(step.count) || 1);
        const interval = (Number(step.interval) || 0.6) * 1000;
        const findTarget = () => {
            if (targetName) {
                return bot.nearestEntity((e) => {
                    if (e === bot.entity || e.type === 'player') return false;
                    const name = (e.customName || e.name || '').toString().toLowerCase();
                    return name.includes(String(targetName).toLowerCase());
                });
            }
            return bot.nearestEntity((e) => e !== bot.entity && e.type !== 'player' && e.type !== 'object');
        };
        // 循环条件带 bot.entity：count>1 时 sleep 间隔里断线，下一轮解引用 position 会 TypeError
        for (let i = 0; i < count && !ctx.aborted && bot.entity; i++) {
            const entity = findTarget();
            if (!entity) { emitLog('没有可攻击目标'); break; }
            // 攻击距离校验：MC 服务器只接受 ~4 格内的攻击，nearestEntity 可能找到几十格外的目标——
            // 以前会静默发无效攻击包（挥空还可能触发反作弊），现在明确提示先靠近。
            const dist = bot.entity.position.distanceTo(entity.position);
            if (dist > 6) {
                emitLog(`目标 ${entity.name || entity.id} 距离 ${dist.toFixed(1)} 格（>6），请先用 goto/goto_nearest 靠近`);
                break;
            }
            emitLog(`攻击 ${entity.name || entity.username || entity.id} (${i + 1}/${count})`);
            try { bot.attack(entity); } catch (_e) { /* 攻击包发送失败不阻塞 */ }
            if (i < count - 1) await sleep(interval);
        }
    },

    async dig(deps, step, ctx) {
        // 挖最近的指定方块：找 → 走近 → 装最佳工具 → 挖（与 automine 同款流程的单步版）。
        const { bot, botInstance, goals, emitLog, gotoWithTimeout } = deps;
        const kw = String(step.block || '').toLowerCase().trim();
        if (!kw) { emitLog('dig 缺少方块名'); return; }
        const maxDist = Number(step.distance) || 16;
        let ids = [];
        try {
            const mc = botInstance.getMcData();
            ids = Object.values(mc.blocksByName || {})
                .filter((b) => b.name.toLowerCase().includes(kw))
                .map((b) => b.id);
        } catch (_e) { /* mcData 不可用走名字匹配 */ }
        const found = bot.findBlock({
            matching: ids.length ? ids : ((b) => b?.name?.toLowerCase().includes(kw)),
            maxDistance: maxDist,
        });
        if (!found) { emitLog(`${maxDist}格内没有 ${step.block}`); return; }
        const pos = found.position;
        emitLog(`挖掘 ${found.name} (${pos.x}, ${pos.y}, ${pos.z})`);
        await gotoWithTimeout(new goals.GoalNear(pos.x, pos.y, pos.z, 2), Number(step.timeout) * 1000);
        if (ctx.aborted || !bot.entity) return;
        const block = bot.blockAt(pos);
        if (!block || block.name !== found.name) { emitLog('目标方块已消失/变化'); return; }
        let tool = null;
        try {
            tool = bot.pathfinder.bestHarvestTool(block);
            if (tool) await bot.equip(tool, 'hand');
        } catch (_e) { /* 无合适工具 */ }
        if (ctx.aborted || !bot.entity) return;
        const canDig = typeof bot.canDigBlock === 'function' ? bot.canDigBlock(block) : true;
        if (!canDig) { emitLog(`当前无法挖掘 ${block.name}（工具/距离不满足）`); return; }
        await bot.lookAt(pos.offset(0.5, 0.5, 0.5), true);
        if (ctx.aborted || !bot.entity) return;
        await bot.dig(block);
        emitLog(`已挖掘 ${block.name}`);
    },

    async place(deps, step, ctx) {
        // 在指定坐标放置背包里的方块：目标格必须是空气，且有相邻实体方块作放置参照面。
        const { bot, goals, emitLog, gotoWithTimeout } = deps;
        const kw = String(step.item || step.block || '').toLowerCase().trim();
        if (!kw) { emitLog('place 缺少物品名'); return; }
        const px = Math.floor(Number(step.x)), py = Math.floor(Number(step.y)), pz = Math.floor(Number(step.z));
        if (Number.isNaN(px) || Number.isNaN(py) || Number.isNaN(pz)) { emitLog('place 需要 x/y/z 坐标'); return; }
        const item = bot.inventory.items().find(
            (i) => i.name.toLowerCase().includes(kw) || customName(i).toLowerCase().includes(kw),
        );
        if (!item) { emitLog(`背包没有: ${step.item || step.block}`); return; }
        await gotoWithTimeout(new goals.GoalNear(px, py, pz, 3), Number(step.timeout) * 1000);
        if (ctx.aborted || !bot.entity) return;
        const targetPos = new Vec3(px, py, pz);
        const targetBlock = bot.blockAt(targetPos);
        if (targetBlock?.boundingBox !== 'empty') {
            emitLog(`(${px}, ${py}, ${pz}) 不是空位，无法放置`);
            return;
        }
        // 六个面找实体邻块当参照；face = 参照块指向目标格的方向
        const faces = [
            new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(-1, 0, 0),
            new Vec3(1, 0, 0), new Vec3(0, 0, -1), new Vec3(0, 0, 1),
        ];
        let ref = null;
        let face = null;
        for (const f of faces) {
            const nb = bot.blockAt(targetPos.plus(f));
            if (nb && nb.boundingBox === 'block') { ref = nb; face = f.scaled(-1); break; }
        }
        if (!ref) { emitLog('目标位置周围没有可参照的实体方块'); return; }
        await bot.equip(item, 'hand');
        if (ctx.aborted || !bot.entity) return;
        emitLog(`放置 ${item.name} @ (${px}, ${py}, ${pz})`);
        await bot.placeBlock(ref, face);
    },

    async craft(deps, step, ctx) {
        // 合成物品：先试 2x2 随身合成，配方需要工作台时自动找最近的工作台走过去。
        const { bot, botInstance, goals, emitLog, gotoWithTimeout } = deps;
        const kw = String(step.item || '').toLowerCase().trim();
        if (!kw) { emitLog('craft 缺少物品名'); return; }
        const count = Math.max(1, Number(step.count) || 1);
        let itemDef = null;
        try {
            const mc = botInstance.getMcData();
            itemDef = mc.itemsByName[kw]
                || Object.values(mc.itemsByName).find((i) => i.name.includes(kw))
                || Object.values(mc.itemsByName).find((i) => (i.displayName || '').toLowerCase().includes(kw));
        } catch (_e) { /* fallthrough */ }
        if (!itemDef) { emitLog(`未知物品: ${step.item}`); return; }
        let table = null;
        let recipes = bot.recipesFor(itemDef.id, null, 1, null) || [];
        if (!recipes.length) {
            // 随身合成不了 → 找工作台
            try {
                const mc = botInstance.getMcData();
                const tableId = mc.blocksByName.crafting_table?.id;
                if (tableId != null) table = bot.findBlock({ matching: tableId, maxDistance: 16 });
            } catch (_e) { /* ignore */ }
            if (table) {
                const tp = table.position;
                emitLog(`前往工作台 (${tp.x}, ${tp.y}, ${tp.z})`);
                await gotoWithTimeout(new goals.GoalNear(tp.x, tp.y, tp.z, 2), Number(step.timeout) * 1000);
                if (ctx.aborted || !bot.entity) return;
                table = bot.blockAt(tp); // 走近后重取，确保引用有效
                recipes = bot.recipesFor(itemDef.id, null, 1, table) || [];
            }
        }
        if (!recipes.length) {
            emitLog(`无法合成 ${itemDef.name}（材料不足${table ? '' : '或附近16格没有工作台'}）`);
            return;
        }
        emitLog(`合成 ${itemDef.name} x${count}`);
        await bot.craft(recipes[0], count, table || undefined);
        emitLog(`已合成 ${itemDef.name} x${count}`);
    },
};
