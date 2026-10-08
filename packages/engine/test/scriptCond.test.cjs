/* 条件叶子解析单测：正则边界/空格容错/数值解析——解析错一个字符，if/while/wait_until 全部判错。 */
const test = require('node:test');
const assert = require('node:assert');
const { parseCondAtom } = require('../src/utils/scriptCond.js');

test('health/food：比较符与小数，空格容错', () => {
  assert.deepEqual(parseCondAtom('health<10'), { kind: 'health', op: '<', value: 10 });
  assert.deepEqual(parseCondAtom('health >= 7.5'), { kind: 'health', op: '>=', value: 7.5 });
  assert.deepEqual(parseCondAtom('food<=6'), { kind: 'food', op: '<=', value: 6 });
  assert.equal(parseCondAtom('health==10'), null); // 生命值不支持 ==（与实现一致）
});

test('背包类：inventory_full / inventory_has / inventory_count', () => {
  assert.deepEqual(parseCondAtom('inventory_full'), { kind: 'inventory_full' });
  assert.deepEqual(parseCondAtom('inventory_has 钻石'), { kind: 'inventory_has', name: '钻石' });
  assert.deepEqual(parseCondAtom('inventory_has Diamond Sword'), { kind: 'inventory_has', name: 'diamond sword' }); // 小写化
  assert.deepEqual(parseCondAtom('inventory_count 圆石 >= 64'), { kind: 'inventory_count', name: '圆石', op: '>=', value: 64 });
  assert.deepEqual(parseCondAtom('inventory_count cobble<10'), { kind: 'inventory_count', name: 'cobble', op: '<', value: 10 });
});

test('玩家/手持/存活类', () => {
  assert.deepEqual(parseCondAtom('players_nearby'), { kind: 'players_nearby' });
  assert.deepEqual(parseCondAtom('no_players_nearby'), { kind: 'no_players_nearby' });
  assert.deepEqual(parseCondAtom('holding 剑'), { kind: 'holding', name: '剑' });
  assert.deepEqual(parseCondAtom('alive'), { kind: 'alive' });
  assert.deepEqual(parseCondAtom('dead'), { kind: 'dead' });
});

test('GUI 类：gui_open/gui_closed/gui_has/gui_slot_has', () => {
  assert.deepEqual(parseCondAtom('gui_open'), { kind: 'gui_open' });
  assert.deepEqual(parseCondAtom('gui_closed'), { kind: 'gui_closed' });
  assert.deepEqual(parseCondAtom('gui_has 下一页'), { kind: 'gui_has', name: '下一页' });
  assert.deepEqual(parseCondAtom('gui_slot_has 13 确认'), { kind: 'gui_slot_has', slot: 13, name: '确认' });
  assert.equal(parseCondAtom('gui_slot_has abc 确认'), null); // 槽位必须是数字
});

test('var 比较：数值字面量转数字，非数值保留字符串', () => {
  assert.deepEqual(parseCondAtom('var counter>=5'), { kind: 'var', name: 'counter', op: '>=', value: 5 });
  assert.deepEqual(parseCondAtom('var mode == auto'), { kind: 'var', name: 'mode', op: '==', value: 'auto' });
  assert.deepEqual(parseCondAtom('var x != 3.14'), { kind: 'var', name: 'x', op: '!=', value: 3.14 });
});

test('未知/空条件返回 null；前后空白容忍', () => {
  assert.equal(parseCondAtom(''), null);
  assert.equal(parseCondAtom(null), null);
  assert.equal(parseCondAtom('whatever nonsense'), null);
  assert.deepEqual(parseCondAtom('  alive  '), { kind: 'alive' });
});
