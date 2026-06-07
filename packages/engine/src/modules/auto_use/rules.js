'use strict';

// 内置默认规则：auto-eat —— 饱食度 < 17 时用任意食物（右键空气）。可被用户编辑/删除。
const DEFAULT_RULES = [
  {
    id: 'auto-eat',
    enabled: true,
    trigger: { type: 'food_below', value: 17 },
    match: { by: 'category', value: 'food' },
    method: 'air',
    cooldownSec: 2,
  },
];

// 判断触发器「条件」是否成立（不含冷却；interval 由 evaluateRules 处理）。
// 注意：state.effects 必须按「效果名」键（如 { speed: { duration } }）——mineflayer 原生 entity.effects
// 是按数字 id 键的，调用方（index.js 适配层）负责转成按名字键，否则 effect_missing 永远判「缺」。
function triggerCondition(trigger, state) {
  switch (trigger && trigger.type) {
    case 'food_below':
      return typeof state.food === 'number' && state.food < trigger.value;
    case 'health_below':
      return typeof state.health === 'number' && state.health < trigger.value;
    case 'effect_missing': {
      const eff = state.effects && state.effects[trigger.effect];
      if (!eff) return true; // 完全没有该 buff
      if (trigger.minRemainSec != null) {
        const remainSec = (eff.duration || 0) / 20; // mineflayer effect.duration 单位 tick
        return remainSec < trigger.minRemainSec;
      }
      return false;
    }
    default:
      return false;
  }
}

// 在背包物品里按 match 找一个可用物品；找不到返回 null。
// items: [{ name, displayName, slot, count, isFood }]
function matchItem(items, match) {
  if (!Array.isArray(items) || !match) return null;
  const by = match.by;
  const val = match.value;
  for (const it of items) {
    if (!it) continue;
    if (by === 'name' && it.name === val) return it;
    if (by === 'category' && val === 'food' && it.isFood) return it;
    if (
      by === 'displayName' &&
      typeof it.displayName === 'string' &&
      it.displayName.toLowerCase().includes(String(val).toLowerCase())
    )
      return it;
    if (by === 'slot' && it.slot === val) return it;
  }
  return null;
}

// 选出本轮应触发的规则（第一条符合的）。
// cooldowns: { ruleId: lastFiredMs }；hasItem(rule): 该规则的物品当前是否在背包。
function evaluateRules(rules, state, cooldowns, hasItem) {
  if (!Array.isArray(rules)) return null;
  const now = state.now;
  const has = typeof hasItem === 'function' ? hasItem : () => true;
  for (const rule of rules) {
    if (!rule || rule.enabled === false) continue;
    if (!has(rule)) continue; // 没物品就跳过，给下一条机会
    const last = (cooldowns && cooldowns[rule.id]) || 0;
    const t = rule.trigger || {};
    if (t.type === 'interval') {
      const everyMs = (t.everySec || 0) * 1000;
      if (everyMs > 0 && now - last >= everyMs) return rule;
      continue;
    }
    const cdMs = (rule.cooldownSec || 0) * 1000;
    if (triggerCondition(t, state) && now - last >= cdMs) return rule;
  }
  return null;
}

module.exports = { DEFAULT_RULES, triggerCondition, matchItem, evaluateRules };
