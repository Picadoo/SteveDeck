/* 触发器判定单测：schedule 当天去重 / interval 节流 / chat_match、damage 的 3 秒消费窗 / respawn 一次性——
   时间敏感逻辑靠人工挂机试根本试不出边界，注入时钟后全部可控回归。 */
const test = require('node:test');
const assert = require('node:assert');
const { shouldTrigger } = require('../src/utils/scriptTrigger.js');

const probe = {
  health: () => 20, food: () => 20,
  playersNearby: () => false, hostileNearby: () => false, inventoryFull: () => false,
};
const at = (iso) => new Date(iso);
const env = (state, now, probeOver = {}) => ({ state, now, probe: { ...probe, ...probeOver } });

test('schedule：命中分钟当天只触发一次，第二天同分钟再次触发；time/value 双字段兼容', () => {
  const state = {};
  const day1 = at('2026-08-13T08:30:10');
  assert.equal(shouldTrigger({ type: 'schedule', value: '08:30' }, 's', env(state, day1)), true);
  assert.equal(shouldTrigger({ type: 'schedule', value: '08:30' }, 's', env(state, at('2026-08-13T08:30:40'))), false); // 同分钟去重
  assert.equal(shouldTrigger({ type: 'schedule', value: '08:31' }, 's', env(state, day1)), false); // 时间不匹配
  assert.equal(shouldTrigger({ type: 'schedule', time: '08:30' }, 's', env(state, at('2026-08-14T08:30:00'))), true); // 次日重新触发（旧字段 time）
  assert.equal(shouldTrigger({ type: 'schedule' }, 's', env(state, day1)), false); // 没配时间
});

test('interval：首查触发并记账，窗口内静默，窗口过再触发；seconds/value 双字段', () => {
  const state = {};
  const t0 = at('2026-08-13T00:00:00');
  assert.equal(shouldTrigger({ type: 'interval', seconds: 60 }, 'job', env(state, t0)), true);
  assert.equal(shouldTrigger({ type: 'interval', seconds: 60 }, 'job', env(state, at('2026-08-13T00:00:59'))), false);
  assert.equal(shouldTrigger({ type: 'interval', seconds: 60 }, 'job', env(state, at('2026-08-13T00:01:00'))), true);
  // 不同脚本名独立记账
  assert.equal(shouldTrigger({ type: 'interval', value: 60 }, 'other', env(state, at('2026-08-13T00:01:01'))), true);
});

test('chat_match：3 秒窗口内 pattern 一致才触发，触发即消费；过期/不匹配不触发', () => {
  const now = at('2026-08-13T00:00:10');
  const s1 = { _lastChatTrigger: { pattern: '领取奖励', time: now.getTime() - 1000 } };
  assert.equal(shouldTrigger({ type: 'chat_match', pattern: '领取奖励' }, 'c', env(s1, now)), true);
  assert.equal(s1._lastChatTrigger, null); // 消费即清
  assert.equal(shouldTrigger({ type: 'chat_match', pattern: '领取奖励' }, 'c', env(s1, now)), false); // 已消费

  const s2 = { _lastChatTrigger: { pattern: '领取奖励', time: now.getTime() - 5000 } };
  assert.equal(shouldTrigger({ type: 'chat_match', pattern: '领取奖励' }, 'c', env(s2, now)), false); // 过期
  const s3 = { _lastChatTrigger: { pattern: '别的', time: now.getTime() - 100 } };
  assert.equal(shouldTrigger({ type: 'chat_match', value: '领取奖励' }, 'c', env(s3, now)), false); // pattern 不一致（value 字段）
});

test('damage：3 秒内消费即清；respawn：一次性标记', () => {
  const now = at('2026-08-13T00:00:10');
  const s = { _justDamaged: now.getTime() - 500 };
  assert.equal(shouldTrigger({ type: 'damage' }, 'd', env(s, now)), true);
  assert.equal(s._justDamaged, null);
  assert.equal(shouldTrigger({ type: 'damage' }, 'd', env(s, now)), false);
  assert.equal(shouldTrigger({ type: 'damage' }, 'd', env({ _justDamaged: now.getTime() - 4000 }, now)), false);

  const r = { _justRespawned: true };
  assert.equal(shouldTrigger({ type: 'respawn' }, 'r', env(r, now)), true);
  assert.equal(r._justRespawned, false);
  assert.equal(shouldTrigger({ type: 'respawn' }, 'r', env(r, now)), false);
});

test('阈值/探针类：health_below、food_below 默认值，mob_nearby 距离透传，未知类型 false', () => {
  const now = at('2026-08-13T00:00:00');
  assert.equal(shouldTrigger({ type: 'health_below', value: 10 }, 'h', env({}, now, { health: () => 9 })), true);
  assert.equal(shouldTrigger({ type: 'health_below' }, 'h', env({}, now, { health: () => 4.5 })), true); // 默认 5
  assert.equal(shouldTrigger({ type: 'food_below' }, 'f', env({}, now, { food: () => 10 })), false); // 默认 10，非严格小于不触发
  let gotDist = null;
  shouldTrigger({ type: 'mob_nearby', value: 12 }, 'm', env({}, now, { hostileNearby: (d) => { gotDist = d; return false; } }));
  assert.equal(gotDist, 12);
  assert.equal(shouldTrigger({ type: 'nonsense' }, 'x', env({}, now)), false);
  assert.equal(shouldTrigger(null, 'x', env({}, now)), false);
});
