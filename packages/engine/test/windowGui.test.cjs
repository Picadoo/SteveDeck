const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const install = require('../src/modules/window_gui');
const registry = require(require.resolve('prismarine-registry', {
  paths: [path.dirname(require.resolve('mineflayer'))],
}))('1.12.2');

function fixture(click) {
  const window = Object.assign(new EventEmitter(), { id: 2, type: 'minecraft:chest', slots: Array(90).fill(null), inventoryStart: 54 });
  window.updateSlot = (index, item) => { window.slots[index] = item; window.emit('updateSlot', index); };
  const bot = Object.assign(new EventEmitter(), { _client: new EventEmitter(), registry, username: 'test', inventory: {}, currentWindow: window, clickWindow: click });
  const events = [];
  const io = { to() { return io; }, emit(event, data) { events.push({ event, data }); } };
  const inst = { bot, config: {}, io, hasWatchers: () => true, cleanupHooks: [] };
  install(inst);
  return { bot, inst, events, dispose: () => inst.cleanupHooks.forEach(fn => { fn(); }) };
}

test('拒绝槽位 57 后同步服务器窗口与光标，不重复点击或假报成功', async () => {
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    setTimeout(() => {
      f.bot.currentWindow.slots[57] = null;
      f.bot._client.emit('set_slot', { windowId: -1, slot: -1, item: { blockId: -1 } });
      f.bot._client.emit('window_items', { windowId: 2 });
    }, 10);
    throw new Error('Server rejected transaction for clicking on slot 57, on window with id 2.');
  });
  f.bot.currentWindow.selectedItem = { type: 1, count: 64 };
  try {
    await assert.rejects(f.inst.clickWindowSlot(57, 0, 0, 2), /已按服务器数据刷新/);
    assert.equal(calls, 1);
    assert.equal(f.bot.currentWindow.selectedItem, null);
    assert.equal(f.inst.getWindow().cursor, null);
    assert.ok(f.events.some(e => e.data.window?.id === 2 && e.data.window.cursor === null));
    assert.equal(f.bot._client.listenerCount('window_items'), 0);
  } finally { f.dispose(); }
  assert.equal(f.bot._client.listenerCount('set_slot'), 0);
});

test('窗口编号、范围和并发校验发生在发包前', async () => {
  let calls = 0;
  let complete;
  const f = fixture(() => { calls++; return new Promise(r => { complete = r; }); });
  try {
    await assert.rejects(f.inst.clickWindowSlot(57, 0, 0, 1), /窗口已切换/);
    await assert.rejects(f.inst.clickWindowSlot(90), /无效/);
    await assert.rejects(f.inst.clickWindowSlot(NaN), /无效/);
    assert.equal(calls, 0);
    const first = f.inst.clickWindowSlot(57, 0, 0, 2);
    await assert.rejects(f.inst.clickWindowSlot(58, 0, 0, 2), /尚未完成/);
    complete();
    assert.equal((await first).id, 2);
    assert.equal(calls, 1);
  } finally { f.dispose(); }
});

test('光标物品数量及 NBT 保留，普通槽位包不覆盖光标', () => {
  const f = fixture(async () => {});
  try {
    const nbt = { type: 'compound', name: '', value: { custom: { type: 'int', value: 42 } } };
    f.bot._client.emit('set_slot', { windowId: -1, slot: -1, item: { blockId: 1, itemCount: 32, itemDamage: 4, nbtData: nbt } });
    assert.equal(f.bot.currentWindow.selectedItem.count, 32);
    assert.deepEqual(f.bot.currentWindow.selectedItem.nbt, nbt);
    f.bot._client.emit('set_slot', { windowId: 2, slot: 57, item: { blockId: -1 } });
    assert.equal(f.bot.currentWindow.selectedItem.count, 32);
  } finally { f.dispose(); }
});

test('服务器先更新槽位再确认交易：最终快照采用服务器数据而非迟到的本地预测', async () => {
  const f = fixture(async () => {
    f.bot._client.emit('set_slot', { windowId: 2, slot: 57, item: { blockId: 1, itemCount: 32, itemDamage: 0 } });
    f.bot._client.emit('set_slot', { windowId: -1, slot: -1, item: { blockId: -1 } });
    // 模拟 transaction accepted 之后的错误本地预测。
    f.bot.currentWindow.slots[57] = null;
    f.bot.currentWindow.selectedItem = { type: 1, count: 32 };
  });
  try {
    const result = await f.inst.clickWindowSlot(57, 0, 0, 2);
    assert.equal(result.slots[57].count, 32);
    assert.equal(result.cursor, null);
  } finally { f.dispose(); }
});
