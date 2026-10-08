const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { Vec3 } = require('vec3');
const { detectSkyLight, installForgeWorld } = require('../src/instance/forgeWorld');
const Chunk = require(require.resolve('prismarine-chunk', {
    paths: [path.dirname(require.resolve('mineflayer'))],
}))('1.12.2');

function packet(skyLight) {
    const column = new Chunk();
    column.skyLightSent = skyLight;
    column.setBlockStateId(new Vec3(6, 22, 8), 20); // 实际故障位置附近的石头
    column.setBlockStateId(new Vec3(6, 38, 8), 16);
    if (!skyLight) for (const section of column.sections) { if (section) section.skyLight = null; }
    return { bitMap: column.getMask(), groundUp: true, chunkData: column.dump() };
}

test('严格识别有/无天空光的 1.12 区块，拒绝截断和尾部多余数据', () => {
    for (const sky of [true, false]) {
        const p = packet(sky);
        assert.equal(detectSkyLight(p), sky);
        assert.equal(detectSkyLight({ ...p, chunkData: p.chunkData.subarray(0, -1) }), null);
        assert.equal(detectSkyLight({ ...p, chunkData: Buffer.concat([p.chunkData, Buffer.from([0])]) }), null);
        assert.equal(detectSkyLight({ ...p, bitMap: 0 }), null);
        assert.equal(detectSkyLight({ ...p, groundUp: false, chunkData: p.chunkData.subarray(0, -256) }), sky);
    }
});

test('实际 Chunk 解码：自定义维度在消费者前修正，切换维度后重新识别', () => {
    const bot = Object.assign(new EventEmitter(), { version: '1.12.2', game: {}, _client: new EventEmitter() });
    // 模拟 Mineflayer game/blocks 插件的事件顺序，不替换实际区块解码器。
    const enter = (p) => {
        bot.game.dimension = ({ '-1': 'the_nether', 0: 'overworld', 1: 'the_end' })[p.dimension];
        bot.emit('game');
    };
    bot._client.on('login', enter);
    bot._client.on('respawn', enter);
    let decoded;
    bot._client.on('map_chunk', (p) => {
        decoded = new Chunk();
        decoded.load(p.chunkData, p.bitMap, bot.game.dimension === 'overworld', p.groundUp);
    });
    installForgeWorld(bot);
    bot._client.emit('login', { dimension: 7 });
    bot._client.emit('map_chunk', packet(true));
    assert.equal(decoded.getBlock(new Vec3(6, 22, 8)).name, 'stone');
    assert.equal(decoded.getBlockStateId(new Vec3(6, 38, 8)), 16);
    assert.equal(bot.game.forgeDimensionId, 7);
    assert.equal(bot.game.dimension, 'overworld');
    bot._client.emit('respawn', { dimension: 8 });
    bot._client.emit('map_chunk', packet(false));
    assert.equal(bot.game.dimension, 'forge:8');
    assert.equal(decoded.getBlock(new Vec3(6, 22, 8)).name, 'stone');
    bot._client.emit('respawn', { dimension: -1 });
    bot._client.emit('map_chunk', packet(false));
    assert.equal(bot.game.dimension, 'the_nether');
});

test('原版维度、其它协议版本与其它机器人不被修改', () => {
    for (const [version, dimension] of [['1.12.2', 0], ['1.20.4', 7]]) {
        const bot = Object.assign(new EventEmitter(), { version, game: { dimension: 'unchanged' }, _client: new EventEmitter() });
        installForgeWorld(bot);
        bot._client.emit('login', { dimension });
        bot._client.emit('map_chunk', packet(true));
        assert.equal(bot.game.dimension, 'unchanged');
    }
    const p = packet(false);
    const column = new Chunk();
    column.load(p.chunkData, p.bitMap, false, true);
    assert.equal(column.getBlock(new Vec3(6, 22, 8)).name, 'stone');
});
