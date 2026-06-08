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

        // 全息文字判定（通用：按结构特征，不按名字）。服务器用「隐身/marker 盔甲架 + 自定义名」做悬浮全息字。
        const FLAG_INVISIBLE = 0x20; // 实体共享 flags(metadata[0]) 的隐身位，全版本通用
        const hasEquip = (e) => Array.isArray(e.equipment) && e.equipment.some((it) => it);
        const flagsByte = (e) => (e.metadata && typeof e.metadata[0] === 'number') ? e.metadata[0] : 0;
        const isHologram = (e, typeName) => {
            const named = !!(e.customName || (e.metadata && e.metadata[2] != null));
            const invisible = (flagsByte(e) & FLAG_INVISIBLE) !== 0;
            if (typeName === 'armor_stand') return invisible || (named && !hasEquip(e)); // 隐身/有名无装备盔甲架=全息/纯展示
            if (typeName === 'area_effect_cloud' && named) return true; // 少数插件用药水云做全息
            return false;
        };

        const out = [];
        for (const entity of Object.values(bot.entities)) {
            if (entity === bot.entity) continue;
            if (['object', 'item', 'xp_orb', 'orb'].includes(entity.type)) continue;
            const dist = bot.entity.position.distanceTo(entity.position);
            if (dist >= 32) continue;

            let typeName = entity.name || entity.type;
            if (!isNaN(typeName)) typeName = mcData.entities[typeName]?.name || `id_${typeName}`;
            const holo = isHologram(entity, typeName);
            // 自定义名牌：1.12.2 名牌在 metadata[2]（mineflayer 不一定填 customName），其次 customName，最后玩家名。
            // 保留颜色码（nameRaw）供前端彩色渲染，name 为去色纯文本。
            let src = entity.customName;
            if (src == null && entity.metadata) src = entity.metadata[2];
            let nameRaw = (src != null ? nameMotd(src) : (entity.username || "")).trim();
            let name = nameRaw.replace(/§[0-9a-fk-orx]/gi, '').trim();
            // Citizens 内部占位名「CIT-<hex>」不是名字 → 当作无名(前端回退到类型/「NPC」)，绝不显示这串 id
            if (/^cit-[0-9a-f]+$/i.test(name)) { name = ''; nameRaw = ''; }

            // 区分「真实在线玩家」与「NPC（多为伪装成玩家的 Citizens 实体）」。
            // 真玩家的账号名必为合法 MC 用户名 [A-Za-z0-9_]{1,16}；NPC 名常含中文/星号/空格 → 判为 NPC 不判真人。
            // （等级前缀/称号是显示名，不影响 entity.username，故有称号的真玩家仍判真人。）
            const VALID_MC_NAME = /^[A-Za-z0-9_]{1,16}$/;
            const realPlayer = entity.type === 'player' && !!(bot.players && bot.players[entity.username]) && VALID_MC_NAME.test(entity.username || '');

            out.push({
                id: entity.id,
                type: typeName,
                name: name || null,
                nameRaw: nameRaw || null,
                realPlayer,
                isHologram: holo, // 全息文字（隐身/marker 盔甲架等）→ 前端默认折叠隐藏
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

            // GoalNear 会结束（GoalFollow 是持续跟随、不收敛），靠近到约 2.5 格。
            // 加 15s 超时：NPC 不可达（隔墙/异层）时 goto 会无限重试、永久挂住整个交互流；超时即停。
            await Promise.race([
                bot.pathfinder.goto(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2.5)).catch(() => {}),
                new Promise((r) => setTimeout(r, 15000)),
            ]);
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
