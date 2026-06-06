const Vec3 = require('vec3');
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
            // 登录宽限期：很多服务器登录后由插件数据库回填背包（会瞬间「获得」一大堆），
            // 开局 12 秒内只更新基线、不刷日志，避免刷屏；之后才记录真实增减。
            const inGrace = botInstance.spawnedAt && Date.now() - botInstance.spawnedAt < 12000;
            if (prev && !inGrace) {
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

            // 深度解析 NBT 获取 Lore 和名字（RPG 服常带 §颜色码，保留供前端彩色渲染）
            let rawName = item.displayName;
            let loreLines = [];
            if (item.nbt && item.nbt.value && item.nbt.value.display) {
                const display = item.nbt.value.display.value;
                if (display.Name) rawName = display.Name.value;
                if (display.Lore) loreLines = display.Lore.value.value;
            }
            rawName = String(rawName);

            return {
                slot: index,
                name: rawName.replace(/§[0-9a-fk-orx]/gi, ''), // 纯文本（逻辑/搜索）
                display: rawName, // 原始（含 §颜色码）
                lore: loreLines.map((l) => String(l)).join('\n'), // 保留颜色码
                count: item.count,
                texture: item.name, // 原始物品 id（贴图/能否装备）
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
    // 穿戴：仅护甲到对应护甲槽（非护甲回退到手）
    botInstance.equipSlot = async (slot) => {
        const it = bot.inventory.slots[slot];
        if (!it) throw new Error('该格为空');
        await bot.equip(it, armorDest(it.name) || 'hand');
        syncInventory();
    };
    // 手持：永远拿到主手，不自动穿到护甲槽（想拿在手上时用这个）
    botInstance.holdSlot = async (slot) => {
        const it = bot.inventory.slots[slot];
        if (!it) throw new Error('该格为空');
        await bot.equip(it, 'hand');
        syncInventory();
    };
    // —— 「使用」物品：忠实模拟一次右键 ——
    // 关键认知：很多物品右键「空气」是无效的，必须右键一个【方块】或【实体】才生效。
    // 旧实现只做了 activateItem()（空挥右键），所以这些物品在背包里「用不了」：
    //   · 盔甲架/刷怪蛋/船/矿车/末影水晶/打火石… → 必须右键【方块】（放置/点燃）
    //   · 染料(给羊)/命名牌/鞍/剪刀/拴绳/桶(挤奶)… → 必须右键【生物】
    // 现在按物品类型选目标，发一次忠实的右键（不重复触发，避免自定义物品被用两次）：
    //   有生物目标 → 右键生物；有落点 → 右键脚下/面前地面；都没有 → 右键空气。
    // 不在这两类里的物品（消耗品、监听「右键空气」的自定义 RPG 物品）走空气分支，行为与旧版一致，不回归。
    const ENTITY_USE = (n) => /(^dye$|_dye$|^ink_sac$|bone_meal|^name_tag$|^saddle$|^shears$|^lead$|_bucket$|^bucket$)/.test(n);
    const BLOCK_USE = (n) =>
        /(^spawn_egg$|_spawn_egg$|armor_stand|end_crystal|^boat$|_boat$|^minecart$|_minecart$|item_frame|painting|^banner$|_banner$|^bed$|_bed$|^sign$|_sign$|flower_pot|^skull$|_head$|flint_and_steel|fire_charge|^lead$|_bucket$|^bucket$)/.test(n);

    // 选一个可放置/可右键的落点：面前一格地面 → 正脚下 → 面前两格（取实心方块，在其顶面操作）
    const pickGroundRef = () => {
        if (!bot.entity) return null;
        const p = bot.entity.position;
        const yaw = bot.entity.yaw;
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        const r = (v) => Math.round(v);
        const spots = [
            p.offset(r(fx), -1, r(fz)),
            p.offset(0, -1, 0),
            p.offset(r(fx * 2), -1, r(fz * 2)),
        ];
        for (const s of spots) {
            const b = bot.blockAt(s);
            if (b && b.boundingBox === 'block') return b;
        }
        return null;
    };
    // 正前方最近的可交互生物（排除玩家/掉落物/经验球/弹射物）
    const pickEntityInFront = (reach = 4) => {
        if (!bot.entities || !bot.entity) return null;
        let best = null, bestD = reach;
        for (const ent of Object.values(bot.entities)) {
            if (ent === bot.entity || !ent.position) continue;
            if (ent.type === 'player') continue;
            if (['object', 'item', 'xp_orb', 'orb', 'projectile', 'other'].includes(ent.type)) continue;
            const d = bot.entity.position.distanceTo(ent.position);
            if (d < bestD) { best = ent; bestD = d; }
        }
        return best;
    };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const totalOf = (nm) => bot.inventory.items().filter((i) => i.name === nm).reduce((s, i) => s + (i.count || 0), 0);

    botInstance.useSlot = async (slot) => {
        const it = bot.inventory.slots[slot];
        if (!it) throw new Error('该格为空');
        await bot.equip(it, 'hand');
        await sleep(120); // 等服务器确认手持
        const held = bot.heldItem;
        const name = (held && held.name) || it.name || '';
        const label = (it.name && customName(it)) || it.displayName || it.name || name;

        // A) 对生物使用：染料给羊 / 名牌 / 鞍 / 剪刀 / 拴绳 / 桶。正前方≤4格有生物就右键它
        //    （模拟真实客户端：先 interact_at 再 interact）。没有生物则落到空气分支。
        if (ENTITY_USE(name)) {
            const ent = pickEntityInFront(4);
            if (ent) {
                const at = ent.position.offset(0, (ent.height || 1) / 2, 0);
                try { await bot.lookAt(at, true); } catch (e) { /* ignore */ }
                try { bot.swingArm('right'); } catch (e) { /* ignore */ }
                try { await bot.activateEntityAt(ent, at); } catch (e) { /* ignore */ }
                try { await bot.activateEntity(ent); } catch (e) { /* ignore */ }
                const who = (ent.displayName || ent.name || ent.username || ent.type || '生物');
                emitItem(`对 ${who} 使用 ${label}`);
                setTimeout(syncInventory, 400);
                return;
            }
        }

        // B) 对方块使用/放置：盔甲架/刷怪蛋/船/打火石… 右键脚下/面前的地面（实体放置无方块更新，正常）。
        //    找不到落点（悬空等）则落到空气分支。
        if (BLOCK_USE(name)) {
            const ref = pickGroundRef();
            if (ref) {
                const before = totalOf(name);
                try { await bot.lookAt(ref.position.offset(0.5, 1, 0.5), true); } catch (e) { /* ignore */ }
                // 放置：placeBlock 发出「手持物品右键方块面」包（这才是放置，旧版用 activateBlock 不会放下手中物）。
                // 放实体(盔甲架/刷怪蛋)无 blockUpdate 会 reject，但放置包已发出 → 用 race 限时 + 数量减少判断成功。
                const placed = await Promise.race([
                    bot.placeBlock(ref, new Vec3(0, 1, 0)).then(() => true).catch(() => false),
                    sleep(800).then(() => false),
                ]);
                await sleep(150);
                if (placed || totalOf(name) < before) {
                    emitItem(`放置/使用 ${label}`);
                    setTimeout(syncInventory, 300);
                    return;
                }
                // 没生效（服务器区域保护，或本就是「右键空气」触发的自定义物品）→ 不 return，落到下面空气兜底
            }
        }

        // C) 右键空气：消耗品(食物/药水/弓) + 监听「右键空气」的自定义 RPG 物品；以及上面没找到目标的兜底。
        try { bot.activateItem(); } catch (e) { /* ignore */ }
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