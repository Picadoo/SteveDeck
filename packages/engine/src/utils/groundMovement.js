const { Vec3 } = require('vec3');
const hazardous = /(?:water|lava|fire|cactus|magma|sweet_berry_bush|powder_snow)/;
const epsilon = 0.001;
const shapes = block => block.shapes || (block.boundingBox === 'block' ? [[0, 0, 0, 1, 1, 1]] : []);
const unsafe = block => !block || block.isLiquid === true || hazardous.test(block.name || '');

// 直发移动只允许已加载、平整有支撑、身体不碰撞的陆地；不替代正常寻路。
function safeGroundPosition(bot, position) {
    if (![position.x, position.y, position.z].every(Number.isFinite)) return false;
    const { x, y, z } = position;
    for (const dx of [-0.29, 0.29]) for (const dz of [-0.29, 0.29]) {
        const px = x + dx, pz = z + dz;
        const block = bot.blockAt(new Vec3(px, y - 0.05, pz));
        if (unsafe(block)) return false;
        const bx = Math.floor(px), by = Math.floor(y - 0.05), bz = Math.floor(pz);
        if (!shapes(block).some(s => Math.abs(by + s[4] - y) < epsilon
            && px >= bx + s[0] && px <= bx + s[3] && pz >= bz + s[2] && pz <= bz + s[5])) return false;
    }
    for (let bx = Math.floor(x - 0.3 + epsilon); bx <= Math.floor(x + 0.3 - epsilon); bx++)
        for (let by = Math.floor(y); by <= Math.floor(y + 1.8 - epsilon); by++)
            for (let bz = Math.floor(z - 0.3 + epsilon); bz <= Math.floor(z + 0.3 - epsilon); bz++) {
                const block = bot.blockAt(new Vec3(bx, by, bz));
                if (unsafe(block)) return false;
                if (shapes(block).some(s => bx + s[0] < x + 0.3 - epsilon && bx + s[3] > x - 0.3 + epsilon
                    && by + s[1] < y + 1.8 - epsilon && by + s[4] > y + epsilon
                    && bz + s[2] < z + 0.3 - epsilon && bz + s[5] > z - 0.3 + epsilon)) return false;
            }
    return true;
}
function safeGroundStep(bot, from, to) {
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.1));
    if (steps > 32 || Math.abs(to.y - from.y) > epsilon) return false;
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        if (!safeGroundPosition(bot, new Vec3(from.x + (to.x - from.x) * t, from.y, from.z + (to.z - from.z) * t))) return false;
    }
    return true;
}
function movementVector(yaw, controls) {
    const forward = Number(!!controls.forward) - Number(!!controls.back);
    const strafe = Number(!!controls.left) - Number(!!controls.right);
    const x = -Math.sin(yaw) * forward + Math.cos(yaw) * strafe;
    const z = -Math.cos(yaw) * forward - Math.sin(yaw) * strafe;
    const length = Math.hypot(x, z);
    return length ? { x: x / length || 0, z: z / length || 0 } : { x: 0, z: 0 };
}
module.exports = { safeGroundPosition, safeGroundStep, movementVector };
