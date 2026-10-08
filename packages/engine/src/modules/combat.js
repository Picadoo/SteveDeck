module.exports = (botInstance) => {
    const bot = botInstance.bot;
    const { entityDisplayName, isArmorStand } = require('../utils/entityName');
    const healthOf = e => e.health ?? (bot.version === '1.12.2' ? e.metadata?.[7] ?? e.metadata?.[6] : undefined);
    const combatPolicy = () => require('../adapters').getServerAdapter(botInstance.config)?.combatPolicy?.(botInstance);
    
    // 确保默认配置完整
    botInstance.combatConfig = { 
        enabled: false, 
        range: 4.5, 
        maxTargets: 2, 
        antiKb: true,
        attackPlayers: false,
        attackMobs: true,
        ...botInstance.combatConfig 
    };

    // 运行统计：模块页展示「在干什么」——开着却看不到效果是用户明确反馈过的痛点
    const stats = { attacks: 0, lastTarget: null, lastAttackAt: 0, startedAt: Date.now(), lastBatch: [] };
    botInstance.getCombatStats = () => {
        const cfg = botInstance.combatConfig;
        const recent = Date.now() - stats.lastAttackAt < 3000;
        const policy = combatPolicy();
        return {
            activity: policy && !policy.ready() ? policy.waitingActivity : recent
                ? `攻击 ${stats.lastTarget || '目标'}`
                : `警戒中（${cfg.range} 格内无${cfg.attackPlayers && cfg.attackMobs ? '目标' : cfg.attackPlayers ? '玩家' : '怪物'}）`,
            attacks: stats.attacks,
            lastTarget: stats.lastTarget || '—',
            targetsPerCycle: recent ? stats.lastBatch.length : 0,
            lastTargets: [...stats.lastBatch.reduce((m,t)=>m.set(t.name,(m.get(t.name)||0)+1),new Map())].map(([name,count])=>`${name} ×${count}`).join('、') || '—',
            targetEntityIds: stats.lastBatch.map(t=>t.id),
        };
    };

    let attacking = false;
    const attackInterval = setInterval(async () => {
        if (attacking) return;
        if (!bot?.entity || !botInstance.combatConfig.enabled) return;
        const policy = combatPolicy();
        if (policy && !policy.ready()) return;
        if (botInstance.isBodyBusy?.()) return; // 用东西时让位一拍(auto_use)
        attacking = true;
        try {
        const cfg = botInstance.combatConfig;
        const p = bot.entity.position;
        const rangeSq = cfg.range * cfg.range;  // 用平方距离比较，省去每个实体的开方运算
        const entities = bot.entities;

        // 单次遍历完成过滤 + 距离计算，距离缓存进数组供排序复用（避免 sort 比较器里重复算 distanceTo）
        const candidates = [];
        for (const id in entities) {
            const e = entities[id];
            if (!e?.position || e === bot.entity || isArmorStand(e)) continue;
            if (policy && !policy.accepts(e)) continue;
            if (typeof healthOf(e) === 'number' && healthOf(e) <= 0) continue;

            const isPlayer = e.type === 'player';
            // 兼容不同版本的实体类型标识
            const isMob = e.type === 'mob' || e.type === 'hostile' || e.type === 'animal';

            if (isPlayer && !cfg.attackPlayers) continue;
            if (isMob && !cfg.attackMobs) continue;
            if (!isPlayer && !isMob) continue;

            const dx = p.x - e.position.x, dy = p.y - e.position.y, dz = p.z - e.position.z;
            const dSq = dx * dx + dy * dy + dz * dz;
            if (dSq <= rangeSq) candidates.push({ e, dSq });
        }

        if (candidates.length === 0) return;
        candidates.sort((a, b) => a.dSq - b.dSq);

        const max = cfg.maxTargets;
        const batch = [];
        for (let i = 0; i < candidates.length && i < max; i++) {
            const t = candidates[i].e;
            try {
                if (t.position && entities[t.id]) {
                    await bot.lookAt(t.position.offset(0, (t.height || 1.8) / 2, 0), true);
                    if (!bot.entity || !botInstance.combatConfig.enabled || (policy && !policy.ready()) || !entities[t.id] || healthOf(t) <= 0 || bot.entity.position.distanceTo(t.position)>cfg.range) continue;
                    bot.attack(t);
                    stats.attacks++;
                    stats.lastTarget = entityDisplayName(t, String(t.id));
                    stats.lastAttackAt = Date.now();
                    batch.push({id:t.id,name:stats.lastTarget});
                }
            } catch (_err) {
                // 实体在攻击瞬间消失，忽略
            }
        }
        stats.lastBatch = batch;
        } finally { attacking = false; }
    }, 400);

    // 保存定时器ID
    botInstance.timers = botInstance.timers || [];
    botInstance.timers.push(attackInterval);

    // 防击退：mineflayer 4.x 不再发 'velocity' 事件（旧实现是死代码，从不触发）。
    // 正确做法：直接拦截服务器对「机器人自身实体」下发的 entity_velocity 包，开启时清掉水平击退
    // （保留竖直分量，避免影响跳跃/坠落）。本监听器注册晚于 mineflayer 内置处理，能在其更新速度后清零。
    const onEntityVelocity = (packet) => {
        try {
            if (!botInstance.combatConfig.antiKb || !bot.entity) return;
            if (packet.entityId !== bot.entity.id) return;
            bot.entity.velocity.x = 0;
            bot.entity.velocity.z = 0;
        } catch (_err) {
            // 忽略
        }
    };
    if (bot._client) bot._client.on('entity_velocity', onEntityVelocity);

    // 清理钩子
    botInstance.cleanupHooks = botInstance.cleanupHooks || [];
    botInstance.cleanupHooks.push(() => {
        clearInterval(attackInterval);
        if (bot._client) bot._client.removeListener('entity_velocity', onEntityVelocity);
    });
};
