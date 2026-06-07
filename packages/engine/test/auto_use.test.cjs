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
