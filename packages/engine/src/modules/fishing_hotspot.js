/**
 * 服务器定制钓鱼 - 阶段一：粒子嗅探诊断
 *
 * 目的：在目标服务器抓取 world_particles 数据包，确认"钓鱼热点"用的是哪种粒子
 * （疑似 slime 史莱姆粒子 id=33）。拿到真实数据后再实现正式的"瞄准热点→抛竿→咬钩→收杆"逻辑。
 *
 * 输出全部走现有日志流（前端日志区可见）：
 *  - 新粒子类型首次出现时即时提示（含 id/名称/坐标/距离）
 *  - 每 4 秒汇总一次 32 格内各粒子的计数与最近坐标（按出现次数排序）
 *  - 咬钩信号 entity_status=31 提示（验证本服咬钩可用标准检测）
 */

// 1.12.2 粒子 id → 名称（EnumParticleTypes 顺序），用于人类可读地确认热点粒子
const PARTICLE_NAMES_1_12 = {
    0: 'explode', 1: 'largeexplode', 2: 'hugeexplosion', 3: 'fireworksSpark',
    4: 'bubble', 5: 'splash', 6: 'wake', 7: 'suspended', 8: 'depthsuspend',
    9: 'crit', 10: 'magicCrit', 11: 'smoke', 12: 'largesmoke', 13: 'spell',
    14: 'instantSpell', 15: 'mobSpell', 16: 'mobSpellAmbient', 17: 'witchMagic',
    18: 'dripWater', 19: 'dripLava', 20: 'angryVillager', 21: 'happyVillager',
    22: 'townaura', 23: 'note', 24: 'portal', 25: 'enchantmenttable', 26: 'flame',
    27: 'lava', 28: 'footstep', 29: 'cloud', 30: 'reddust', 31: 'snowballpoof',
    32: 'snowshovel', 33: 'slime', 34: 'heart', 35: 'barrier', 36: 'iconcrack',
    37: 'blockcrack', 38: 'blockdust', 39: 'droplet', 40: 'take', 41: 'mobappearance',
    42: 'dragonbreath', 43: 'endRod', 44: 'damageIndicator', 45: 'sweepAttack',
    46: 'fallingdust', 47: 'totem', 48: 'spit'
};

const FLUSH_INTERVAL = 4000;   // 汇总周期 ms
const SNIFF_RADIUS = 32;       // 只关注此范围内的粒子（过滤远处环境粒子）

module.exports = (botInstance) => {
    const bot = botInstance.bot;

    const emitLog = (msg) => {
        botInstance.io.to(botInstance._room).to('admin').emit('log', {
            user: bot.username, ownerId: botInstance.config.ownerId,
            msg, time: new Date().toLocaleTimeString()
        });
    };

    const particleName = (id) => PARTICLE_NAMES_1_12[id] !== undefined ? PARTICLE_NAMES_1_12[id] : `id_${id}`;

    const sniff = botInstance._particleSniff = {
        active: false,
        buckets: new Map(), // particleId -> { count, nearest:{x,y,z,dist} }
        seen: new Set(),    // 已即时提示过的 id
        flushTimer: null,
        onParticle: null,
        onStatus: null
    };

    const flush = () => {
        if (sniff.buckets.size === 0) return;
        const lines = [...sniff.buckets.entries()]
            .sort((a, b) => b[1].count - a[1].count)
            .map(([id, b]) => `  [${id}] ${particleName(id)} ×${b.count}  最近(${b.nearest.x.toFixed(0)}, ${b.nearest.y.toFixed(0)}, ${b.nearest.z.toFixed(0)}) ${b.nearest.dist.toFixed(1)}m`);
        emitLog(`🔬 粒子嗅探（近${FLUSH_INTERVAL / 1000}秒，${SNIFF_RADIUS}格内）:\n${lines.join('\n')}`);
        sniff.buckets.clear();
    };

    const detach = () => {
        if (bot._client) {
            if (sniff.onParticle) bot._client.removeListener('world_particles', sniff.onParticle);
            if (sniff.onStatus) bot._client.removeListener('entity_status', sniff.onStatus);
        }
        if (sniff.flushTimer) { clearInterval(sniff.flushTimer); sniff.flushTimer = null; }
    };

    botInstance.startParticleSniff = () => {
        if (sniff.active) return;
        if (!bot._client) { emitLog('⚠️ 客户端未就绪，无法嗅探'); return; }
        sniff.active = true;
        sniff.buckets.clear();
        sniff.seen.clear();

        sniff.onParticle = (packet) => {
            try {
                if (!packet || packet.particleId === undefined) return;
                const id = packet.particleId;
                const p = bot.entity && bot.entity.position;
                let dist = 0;
                if (p) {
                    const dx = p.x - packet.x, dy = p.y - packet.y, dz = p.z - packet.z;
                    dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (dist > SNIFF_RADIUS) return; // 只看附近
                }
                let b = sniff.buckets.get(id);
                if (!b) {
                    b = { count: 0, nearest: { x: packet.x, y: packet.y, z: packet.z, dist } };
                } else if (dist < b.nearest.dist) {
                    b.nearest = { x: packet.x, y: packet.y, z: packet.z, dist };
                }
                b.count++;
                sniff.buckets.set(id, b);

                if (!sniff.seen.has(id)) {
                    sniff.seen.add(id);
                    emitLog(`🔬 发现新粒子: [${id}] ${particleName(id)} @ (${packet.x.toFixed(0)}, ${packet.y.toFixed(0)}, ${packet.z.toFixed(0)}) ${dist.toFixed(1)}m, count字段=${packet.particles}`);
                }
            } catch (e) { /* 单包异常忽略 */ }
        };

        sniff.onStatus = (packet) => {
            try {
                if (packet && packet.entityStatus === 31) {
                    emitLog(`🎣 检测到咬钩信号 entity_status=31 (entityId=${packet.entityId}) —— 本服支持标准咬钩检测`);
                }
            } catch (e) { /* 忽略 */ }
        };

        bot._client.on('world_particles', sniff.onParticle);
        bot._client.on('entity_status', sniff.onStatus);
        sniff.flushTimer = setInterval(flush, FLUSH_INTERVAL);
        botInstance.timers = botInstance.timers || [];
        botInstance.timers.push(sniff.flushTimer);

        emitLog(`🔬 粒子嗅探已开启：监听 world_particles + entity_status（${SNIFF_RADIUS}格内，每${FLUSH_INTERVAL / 1000}秒汇总）。请站到钓鱼点附近，观察热点出现时是哪个粒子 id。`);
    };

    botInstance.stopParticleSniff = () => {
        if (!sniff.active) return;
        sniff.active = false;
        detach();
        flush(); // 输出最后一批
        emitLog('🔬 粒子嗅探已关闭');
    };

    botInstance.cleanupHooks = botInstance.cleanupHooks || [];
    botInstance.cleanupHooks.push(() => {
        if (sniff.active) { sniff.active = false; detach(); }
    });
};
