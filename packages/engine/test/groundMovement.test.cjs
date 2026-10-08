const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { safeGroundStep, movementVector } = require('../src/utils/groundMovement');
const { mixin } = require('../src/instance/rawMove');
const solid = { name: 'stone', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] };
const air = { name: 'air', boundingBox: 'empty', shapes: [] };
const world = override => ({ blockAt(p) {
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
    const block = override?.(x, y, z);
    return block === undefined ? (y === 63 ? solid : air) : block;
} });

test('Mineflayer 朝向：零偏航前进向北、左移向东，斜行不加速', () => {
    assert.deepEqual(movementVector(0, { forward: true }), { x: 0, z: -1 });
    assert.deepEqual(movementVector(0, { left: true }), { x: 1, z: 0 });
    const diagonal = movementVector(Math.PI / 2, { forward: true, left: true });
    assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - 1) < 1e-9);
});

test('每步检查完整脚部支撑与身体碰撞，水、空洞、未知区块和墙拒绝移动', () => {
    const from = new Vec3(0.5, 64, 0.5), to = new Vec3(0.5, 64, 0.07);
    assert.equal(safeGroundStep(world(), from, to), true);
    for (const hazard of [air, null, { name: 'water', boundingBox: 'empty', shapes: [] }]) {
        assert.equal(safeGroundStep(world((_x, y, z) => y === 63 && z < 0 ? hazard : undefined), from, to), false);
    }
    assert.equal(safeGroundStep(world((_x, y, z) => y === 65 && z < 0 ? solid : undefined), from, to), false);
});

test('不跨越已加载段之间的空洞，不把高低台阶当平地', () => {
    const from = new Vec3(0.5, 64, 0.5), to = new Vec3(2.5, 64, 0.5);
    assert.equal(safeGroundStep(world((x, y) => x === 1 && y === 63 ? air : undefined), from, to), false);
    assert.equal(safeGroundStep(world(), from, to.offset(0, 1, 0)), false);
});

test('被水边阻挡时不发 position 包，停止恢复此前物理状态', () => {
    let writes = 0;
    const inst = { ...mixin, _raw: { forward: true }, _rawPhysicsEnabled: true,
        timers: [], uiLog() {}, bot: { ...world((_x, y, z) => y === 63 && z < 0 ? air : undefined),
            physicsEnabled: false, entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0 },
            _client: { write() { writes++; } } } };
    inst._rawTick();
    assert.equal(writes, 0);
    assert.equal(inst.bot.entity.position.z, 0.5);
    assert.equal(inst.bot.physicsEnabled, true);
    assert.equal(inst._raw, null);
});
