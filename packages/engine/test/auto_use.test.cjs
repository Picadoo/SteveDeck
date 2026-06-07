const test = require('node:test');
const assert = require('node:assert');
const { DEFAULT_RULES, triggerCondition, matchItem, evaluateRules } = require('../src/modules/auto_use/rules.js');

test('matchItem by name', () => {
  const items = [{ name: 'cooked_beef', slot: 5 }, { name: 'golden_apple', slot: 6 }];
  assert.equal(matchItem(items, { by: 'name', value: 'golden_apple' }).slot, 6);
  assert.equal(matchItem(items, { by: 'name', value: 'diamond' }), null);
});

test('matchItem by category food (用 isFood 注解)', () => {
  const items = [{ name: 'stone', slot: 1, isFood: false }, { name: 'bread', slot: 2, isFood: true }];
  assert.equal(matchItem(items, { by: 'category', value: 'food' }).name, 'bread');
});

test('matchItem by displayName 包含（RPG 自定义名）', () => {
  const items = [{ name: 'paper', slot: 3, displayName: '活动钥匙·夏日' }];
  assert.equal(matchItem(items, { by: 'displayName', value: '钥匙' }).slot, 3);
});

test('triggerCondition food_below / health_below', () => {
  assert.equal(triggerCondition({ type: 'food_below', value: 17 }, { food: 12 }), true);
  assert.equal(triggerCondition({ type: 'food_below', value: 17 }, { food: 20 }), false);
  assert.equal(triggerCondition({ type: 'health_below', value: 10 }, { health: 6 }), true);
});

test('triggerCondition effect_missing', () => {
  assert.equal(triggerCondition({ type: 'effect_missing', effect: 'speed' }, { effects: {} }), true);
  assert.equal(triggerCondition({ type: 'effect_missing', effect: 'speed' }, { effects: { speed: { duration: 200 } } }), false);
  // duration 单位 tick：5 tick = 0.25s < 3s → 视为缺
  assert.equal(triggerCondition({ type: 'effect_missing', effect: 'speed', minRemainSec: 3 }, { effects: { speed: { duration: 5 } } }), true);
});

test('evaluateRules 取第一条符合 + 尊重冷却 + 物品可用', () => {
  const rules = [{ id: 'eat', enabled: true, trigger: { type: 'food_below', value: 17 }, match: { by: 'category', value: 'food' }, cooldownSec: 2 }];
  const state = { now: 100000, food: 10, effects: {} };
  assert.equal(evaluateRules(rules, state, { eat: 99000 }, () => true), null);        // 1s 前用过，冷却内
  assert.equal(evaluateRules(rules, state, { eat: 90000 }, () => true).id, 'eat');     // 冷却已过 + 有物品
  assert.equal(evaluateRules(rules, state, { eat: 90000 }, () => false), null);        // 没物品
  assert.equal(evaluateRules([{ ...rules[0], enabled: false }], state, {}, () => true), null); // 禁用
});

test('evaluateRules interval 节奏', () => {
  const rules = [{ id: 'key', enabled: true, trigger: { type: 'interval', everySec: 60 }, match: { by: 'name', value: 'paper' } }];
  assert.equal(evaluateRules(rules, { now: 100000, effects: {} }, { key: 50000 }, () => true), null);     // 50s < 60s
  assert.equal(evaluateRules(rules, { now: 100000, effects: {} }, { key: 30000 }, () => true).id, 'key'); // 70s ≥ 60s
});

test('DEFAULT_RULES 含一条 auto-eat', () => {
  const eat = DEFAULT_RULES.find((r) => r.id === 'auto-eat');
  assert.ok(eat);
  assert.equal(eat.trigger.type, 'food_below');
});

test('auto_use 模块：低饱食 + 背包有面包 → 触发 equip+activateItem', async () => {
  const factory = require('../src/modules/auto_use/index.js');
  const calls = { equip: [], activate: 0, deactivate: 0, quickBar: null };
  const breadStack = { name: 'bread', slot: 36, count: 3, displayName: 'Bread' };
  const bot = {
    username: 'tester', food: 8, health: 20, quickBarSlot: 0,
    entity: { effects: {} },
    heldItem: null,
    inventory: { slots: { 36: breadStack }, items: () => [breadStack] },
    equip: async (it, dest) => { calls.equip.push([it.name, dest]); },
    activateItem: () => { calls.activate++; },
    deactivateItem: () => { calls.deactivate++; },
    setControlState: () => {},
    setQuickBarSlot: (s) => { calls.quickBar = s; },
  };
  const inst = {
    bot, io: { to: () => ({ to: () => ({ emit: () => {} }) }) },
    config: { ownerId: 'o1' }, _room: 'user:o1',
    timers: [], cleanupHooks: [],
    bodyBusy: 0,
    isBodyBusy() { return Date.now() < (this.bodyBusy || 0); },
    setBodyBusy(ms) { this.bodyBusy = Date.now() + (ms || 0); },
    getMcData: () => ({ foodsByName: { bread: { foodPoints: 5 } } }),
    syncInventory: () => {},
  };
  factory(inst);                              // 安装模块
  inst.toggleAutoUse(true, {});               // 开启（用默认 auto-eat 规则）
  assert.ok(typeof inst.autoUseTask._evalTick === 'function');
  await inst.autoUseTask._evalTick();         // 手动跑一轮评估
  assert.deepEqual(calls.equip[0], ['bread', 'hand']); // 把面包拿到手
  assert.equal(calls.activate, 1);                     // 右键使用了一次
  assert.ok(inst.isBodyBusy());                        // 用东西时占用了身体
  inst.toggleAutoUse(false);                           // 关闭
  assert.equal(inst.autoUseTask.timer, null);          // 定时器已清
});

test('effect_missing：适配层把 mineflayer 数字键 effects 转成按名字键（修计划里的 bug）', () => {
  const factory = require('../src/modules/auto_use/index.js');
  // mineflayer entity.effects 按数字 id 键（speed=1），值含 id/duration
  const bot = {
    username: 't', food: 20, health: 20, quickBarSlot: 0,
    entity: { effects: { 1: { id: 1, amplifier: 0, duration: 200 } } },
    inventory: { slots: {}, items: () => [] },
    equip: async () => {}, activateItem: () => {}, deactivateItem: () => {},
    setControlState: () => {}, setQuickBarSlot: () => {},
  };
  const inst = {
    bot, io: { to: () => ({ to: () => ({ emit: () => {} }) }) },
    config: { ownerId: 'o' }, _room: 'r', timers: [], cleanupHooks: [],
    bodyBusy: 0, isBodyBusy() { return false; }, setBodyBusy() {},
    getMcData: () => ({ effects: { 1: { id: 1, name: 'Speed' } }, foodsByName: {} }),
    syncInventory: () => {},
  };
  factory(inst);
  const eff = inst.autoUseTask._effectsByName();
  assert.ok(eff.speed, '数字键 1 应被映射为按名字键 speed');
  assert.equal(eff.speed.duration, 200);
});

