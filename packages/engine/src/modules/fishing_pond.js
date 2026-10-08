const { Vec3 } = require('vec3');
const { safeGroundPosition } = require('../utils/groundMovement');
const water = b => b && ['water', 'flowing_water'].includes(b.name);
const key = (x, y, z) => `${x},${y},${z}`;
const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function scanFishingPond(bot) {
    if (!bot.entity) throw new Error('机器人未在线');
    const origin = bot.entity.position;
    const cx = Math.floor(origin.x), cy = Math.floor(origin.y), cz = Math.floor(origin.z), radius = 24;
    const surfaces = new Map();
    let unknown = 0;
    for (let x = cx - radius; x <= cx + radius; x++) for (let z = cz - radius; z <= cz + radius; z++) {
        for (let y = cy + 2; y >= cy - 4; y--) {
            const b = bot.blockAt(new Vec3(x, y, z));
            if (!b) { unknown++; continue; }
            if (water(b) && bot.blockAt(new Vec3(x, y + 1, z))?.name === 'air') {
                surfaces.set(key(x, y, z), { x, y, z }); break;
            }
        }
    }
    const forward = { x: -Math.sin(bot.entity.yaw), z: -Math.cos(bot.entity.yaw) };
    const seeds = [...surfaces.values()].filter(p => (p.x + 0.5 - origin.x) * forward.x + (p.z + 0.5 - origin.z) * forward.z >= 0)
        .sort((a, b) => Math.hypot(a.x + 0.5 - origin.x, a.z + 0.5 - origin.z) - Math.hypot(b.x + 0.5 - origin.x, b.z + 0.5 - origin.z));
    const visited = new Set(); let pool = [];
    for (const seed of seeds) {
        if (visited.has(key(seed.x, seed.y, seed.z))) continue;
        const component = [seed]; visited.add(key(seed.x, seed.y, seed.z));
        for (let i = 0; i < component.length; i++) for (const [dx, dz] of dirs) {
            const p = component[i], k = key(p.x + dx, p.y, p.z + dz);
            if (surfaces.has(k) && !visited.has(k)) { visited.add(k); component.push(surfaces.get(k)); }
        }
        if (component.length >= 8) { pool = component; break; }
    }
    if (!pool.length) throw new Error('面前未找到至少八格连续且已加载的水面');
    const safe = (x, y, z) => safeGroundPosition(bot, new Vec3(x + 0.5, y, z + 0.5));
    if (!safe(cx, cy, cz)) throw new Error('当前脚下不是安全陆地，不能以此建立活动区');
    const near = new Set();
    for (const p of pool) for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
        if (dx * dx + dz * dz <= 16) near.add(`${p.x + dx},${p.z + dz}`);
    }
    const stands = [{ x: cx, y: cy, z: cz }], seen = new Set([key(cx, cy, cz)]);
    for (let i = 0; i < stands.length && stands.length < 3000; i++) for (const [dx, dz] of dirs) for (const dy of [0, 1, -1]) {
        const p = stands[i], x = p.x + dx, y = p.y + dy, z = p.z + dz, k = key(x, y, z);
        if (Math.abs(x - cx) > radius || Math.abs(z - cz) > radius || Math.abs(y - cy) > 2 || seen.has(k) || !near.has(`${x},${z}`) || !safe(x, y, z)) continue;
        seen.add(k); stands.push({ x, y, z });
    }
    const bounds = list => ({ minX: Math.min(...list.map(p => p.x)), maxX: Math.max(...list.map(p => p.x)), minZ: Math.min(...list.map(p => p.z)), maxZ: Math.max(...list.map(p => p.z)) });
    return { scannedAt: new Date().toISOString(), dimension: bot.game?.dimension, origin: { x: origin.x, y: origin.y, z: origin.z, yaw: bot.entity.yaw },
        waterY: pool[0].y, water: pool, stands, bounds: bounds(pool), landBounds: bounds(stands), unknown,
        clipped: pool.some(p => Math.abs(p.x - cx) === radius || Math.abs(p.z - cz) === radius) };
}
module.exports = { scanFishingPond };
