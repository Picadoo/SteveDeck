require('tsx/cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { botManager } = require('../src/botManager.ts');
const { registerModuleHandlers } = require('../src/api/moduleHandlers.ts');

test('手动动作通过真实 Socket handler 命中目标，并将失败返回 UI', async () => {
    const socket = new EventEmitter();
    const calls = [];
    let target = { id: 42 };
    let block = null;
    const bot = {
        entity: {},
        entityAtCursor: (range) => { assert.equal(range, 3); return target; },
        blockAtCursor: (range) => { assert.equal(range, 4.5); return block; },
        attack: (entity) => calls.push(['attack', entity.id]),
        swingArm: () => calls.push(['swing']),
        activateEntity: async (entity) => calls.push(['entity', entity.id]),
        activateBlock: async () => calls.push(['block']),
        activateItem: () => calls.push(['item']),
        deactivateItem: () => {},
    };
    const original = botManager.getInstance;
    botManager.getInstance = () => ({ bot });
    registerModuleHandlers({}, socket);
    const tap = (action) => new Promise((resolve) => socket.emit('module:action', {
        id: 'test', module: 'move', action: 'tap', args: { action },
    }, resolve));
    try {
        assert.equal((await tap('attack')).ok, true);
        assert.equal((await tap('use')).ok, true);
        target = null;
        assert.equal((await tap('attack')).ok, true);
        block = { name: 'chest' };
        assert.equal((await tap('use')).ok, true);
        block = null;
        assert.equal((await tap('use')).ok, true);
        assert.deepEqual(calls, [['attack', 42], ['entity', 42], ['swing'], ['block'], ['item']]);
        target = { id: 42 };
        bot.activateEntity = async () => { throw new Error('interaction failed'); };
        const result = await tap('use');
        assert.equal(result.ok, false);
        assert.match(result.error, /interaction failed/);
    } finally {
        botManager.getInstance = original;
        socket.removeAllListeners();
    }
});
