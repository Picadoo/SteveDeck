// 被动粒子观测：只记录服务端发来的粒子和相关聊天，不抛竿、不移动。
// 用于识别模组服把“火花”映射到哪个粒子 ID。
const fs = require('fs');
const { dataPath } = require('../config/paths');

module.exports = (inst) => {
    if (!inst.config.settings?.particleObserve) return;
    const bot = inst.bot;
    const counts = {};
    const samples = [];
    const channels = {};
    const hints = [];
    const events = {};
    const eventSamples = [];
    const startedAt = Date.now();
    const file = dataPath(`particle-observation-${inst.config.id}.json`);
    const particleNames = {};
    for (const [name, data] of Object.entries(bot.registry?.particlesByName || {})) {
        if (data && Number.isInteger(data.id)) particleNames[data.id] = name;
    }
    const write = () => {
        try {
            fs.writeFileSync(file, JSON.stringify({
                username: inst.config.username, startedAt, updatedAt: Date.now(), counts, channels,
                hints: hints.slice(-20), samples: samples.slice(-200), events, eventSamples: eventSamples.slice(-100),
            }, null, 2));
        } catch (_) { /* 观测文件失败不影响机器人 */ }
    };
    const onParticle = (p) => {
        const id = Number(p.particleId);
        counts[id] = (counts[id] || 0) + 1;
        if (![p.x, p.y, p.z].every(Number.isFinite)) return;
        const self = bot.entity?.position;
        if (self && Math.hypot(p.x - self.x, p.y - self.y, p.z - self.z) > 32) return;
        samples.push({ at: Date.now(), id, name: particleNames[id] || `particle_${id}`, x: p.x, y: p.y, z: p.z, offsetX: p.offsetX, offsetY: p.offsetY, offsetZ: p.offsetZ, count: p.particles, data: p.particleData });
        if (samples.length > 200) samples.shift();
    };
    const onPayload = (p) => { const channel = String(p.channel || ''); channels[channel] = (channels[channel] || 0) + 1; };
    const onMessage = (text) => {
        const plain = String(text || '').replace(/§./g, '');
        if (!/火花|特效|鱼窝|水花|钓鱼|鱼钩|咬钩/.test(plain)) return;
        hints.push({ at: Date.now(), text: plain.slice(0, 300) });
        if (hints.length > 20) hints.shift();
    };
    bot._client.on('world_particles', onParticle);
    bot._client.on('custom_payload', onPayload);
    // 特效有时不走 world_particles：Forge/模组服可能用 world_event、effect、声音或实体事件。
    const extra = {
        world_event: p => ({ keys: Object.keys(p), event: p.event, effectId: p.effectId, data: p.data, location: p.location, x: p.x, y: p.y, z: p.z }),
        effect: p => ({ effectId: p.effectId, entityId: p.entityId, amplifier: p.amplifier, duration: p.duration }),
        entity_effect: p => ({ effectId: p.effectId, entityId: p.entityId, amplifier: p.amplifier, duration: p.duration }),
        named_sound_effect: p => ({ soundName: p.soundName, category: p.category, x: p.x, y: p.y, z: p.z, volume: p.volume, pitch: p.pitch }),
        sound_effect: p => ({ soundId: p.soundId, category: p.category, x: p.x, y: p.y, z: p.z, volume: p.volume, pitch: p.pitch }),
        spawn_entity: p => ({ entityId: p.entityId, type: p.type, objectData: p.objectData, x: p.x, y: p.y, z: p.z }),
        entity_status: p => ({ entityId: p.entityId, entityStatus: p.entityStatus }),
    };
    const extraListeners = Object.entries(extra).map(([name, pick]) => {
        const fn = p => {
            events[name] = (events[name] || 0) + 1;
            let detail = {};
            try { detail = pick(p) || {}; } catch (_) { /* ignore malformed packet */ }
            eventSamples.push({ at: Date.now(), name, ...detail });
            if (eventSamples.length > 100) eventSamples.shift();
        };
        bot._client.on(name, fn);
        return [name, fn];
    });
    bot.on('messagestr', onMessage);
    const timer = setInterval(write, 1000);
    write();
    inst.getParticleObservation = () => ({ username: inst.config.username, counts: { ...counts }, channels: { ...channels }, events: { ...events }, hints: hints.slice(-20), samples: samples.slice(-30), eventSamples: eventSamples.slice(-30), file });
    inst.cleanupHooks.push(() => {
        clearInterval(timer);
        bot._client.removeListener('world_particles', onParticle);
        bot._client.removeListener('custom_payload', onPayload);
        for (const [name, fn] of extraListeners) bot._client.removeListener(name, fn);
        bot.removeListener('messagestr', onMessage);
        write();
        delete inst.getParticleObservation;
    });
};
