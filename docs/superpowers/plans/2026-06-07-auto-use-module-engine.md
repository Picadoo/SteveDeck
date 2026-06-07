# 自动使用（auto-use）模块 — 引擎侧实现计划（Plan 1/2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现通用「自动使用」引擎模块（条件→使用物品，玩家自配规则，auto-eat 为内置默认规则）+ 一个 `bodyBusy` 协调原语，让它与战斗/挖矿/农场/追怪/脚本同时运行而不互相打架。

**Architecture:** 纯规则逻辑（`auto_use/rules.js`，无 mineflayer，可单测）+ 工厂模块（`auto_use/index.js`，每秒评估一次，命中规则时抢占 `bodyBusy` 软锁、换手持、右键、复位）。其它循环在 `bodyBusy` 期间让位一拍。经现有 `MODULE_TOGGLE`/`MODULE_CONFIG` 控制、随 `bots.json` 持久化、重连自动恢复。

**Tech Stack:** Node ≥20（用内置 `node --test` + `node:assert`，零新依赖）、CommonJS、mineflayer 4.33、TypeScript（协议/handlers）。

**Spec:** `docs/superpowers/specs/2026-06-07-auto-use-module-design.md`

**范围说明:** 本计划只做**引擎侧**（模块 + 协调 + 持久化 + 协议 + 测试），完成后即可通过 socket 命令开关/配置、可单测、可手测。**UI（ModulesTab 卡片 + 规则编辑器）是 Plan 2，另写。** v1 的 `method` 完整支持 `air`/`sneak_air`；`block`/`entity` 复用现有 `botInstance.useSlot(slot)` 的智能分流。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `packages/engine/src/modules/auto_use/rules.js` | 纯规则逻辑：`triggerCondition`/`matchItem`/`evaluateRules`/`DEFAULT_RULES` | 新建 |
| `packages/engine/src/modules/auto_use/index.js` | 工厂模块：评估循环、`performUse`、`toggleAutoUse`、清理 | 新建 |
| `packages/engine/test/auto_use.test.cjs` | 单元测试（`node --test`） | 新建 |
| `packages/engine/package.json` | 加 `test:unit` 脚本 | 改 |
| `packages/engine/src/BotInstance.js` | `bodyBusy` 字段 + `isBodyBusy/setBodyBusy` + 注册模块 + 重连恢复 | 改 |
| `packages/engine/src/modules/combat.js` | 加 `bodyBusy` 让位守卫 | 改 |
| `packages/engine/src/modules/automine.js` | 加 `bodyBusy` 让位守卫 | 改 |
| `packages/engine/src/modules/mob_hunter.js` | 加 `bodyBusy` 让位守卫 | 改 |
| `packages/engine/src/modules/auto_farm.js` | 加 `bodyBusy` 让位守卫 | 改 |
| `packages/engine/src/api/moduleHandlers.ts` | `MODULE_TOGGLE`/`MODULE_CONFIG` 增 `auto_use` 分支 | 改 |
| `packages/protocol/src/index.ts` | `AutoUseRule` 类型 + `BotSettings.autoUse` | 改 |

---

## Task 1: 纯规则逻辑 + 单元测试（rules.js）

**Files:**
- Test: `packages/engine/test/auto_use.test.cjs`
- Create: `packages/engine/src/modules/auto_use/rules.js`
- Modify: `packages/engine/package.json:15`（在 `test` 脚本后加 `test:unit`）

- [ ] **Step 1: 写失败测试** `packages/engine/test/auto_use.test.cjs`

```js
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm -C packages/engine exec node --test test/auto_use.test.cjs`
Expected: FAIL — `Cannot find module '../src/modules/auto_use/rules.js'`

- [ ] **Step 3: 实现** `packages/engine/src/modules/auto_use/rules.js`

```js
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
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm -C packages/engine exec node --test test/auto_use.test.cjs`
Expected: PASS（8 个 test 全过）

- [ ] **Step 5: 加 `test:unit` 脚本**

修改 `packages/engine/package.json:15`，把：
```json
    "test": "node test/control-plane.cjs"
```
改为：
```json
    "test": "node test/control-plane.cjs",
    "test:unit": "node --test test/auto_use.test.cjs"
```

- [ ] **Step 6: 提交**

```bash
git add packages/engine/test/auto_use.test.cjs packages/engine/src/modules/auto_use/rules.js packages/engine/package.json
git commit -m "feat(auto-use): pure rule logic + unit tests"
```

---

## Task 2: bodyBusy 协调原语（BotInstance）

**Files:**
- Modify: `packages/engine/src/BotInstance.js:61`（构造器加字段）、`:85`（加方法）

> 该原语依附于 `BotInstance`（实例化需要 mineflayer + 真实连接），无法脱离地单测，因此不写独立单测；其行为由 **Task 3 的 mock-bot 测试**（在 `inst` 桩上实装同样的 `isBodyBusy/setBodyBusy` 并经 `evalTick`/`performUse` 实际驱动）与 **Task 6 集成冒烟**覆盖。本任务是「接线」，无 red/green 循环。

- [ ] **Step 1: 在 BotInstance 实装字段与方法**

在 `packages/engine/src/BotInstance.js` 构造器，找到 `:61`：
```js
        this.recorder = new Recorder(this);
```
在其后、`this.init();` 之前插入：
```js

        // 身体协调软锁：某模块用东西(吃/喝/右键)时占用，到期前其它循环让位一拍。零优先级。
        this.bodyBusy = 0;
```

再找到 `emitRecordingState` 方法结尾（`:85` 的 `}`，即该方法的闭合花括号），在其后插入两个方法：
```js

    // 身体协调：当前是否有动作占用身体（用东西时为 true）。
    isBodyBusy() { return Date.now() < (this.bodyBusy || 0); }
    // 占用身体 ms 毫秒（auto_use 执行一次「使用」时调用）。
    setBodyBusy(ms) { this.bodyBusy = Date.now() + (ms || 0); }
```

- [ ] **Step 2: 单测仍全过（Task 1 不回归）**

Run: `pnpm -C packages/engine exec node --test test/auto_use.test.cjs`
Expected: PASS

- [ ] **Step 3: typecheck（确保没破坏 TS 引用）**

Run: `pnpm -C packages/engine typecheck`
Expected: 无错误（`.js` 不参与类型检查，应原样通过）

- [ ] **Step 4: 提交**

```bash
git add packages/engine/src/BotInstance.js
git commit -m "feat(auto-use): add bodyBusy coordination primitive on BotInstance"
```

---

## Task 3: auto_use 工厂模块 + 注册 + mock-bot 测试

**Files:**
- Create: `packages/engine/src/modules/auto_use/index.js`
- Modify: `packages/engine/src/BotInstance.js:135`（MODULE_NAMES 加 `auto_use`）
- Test: `packages/engine/test/auto_use.test.cjs`（追加 mock-bot 测试）

- [ ] **Step 1: 追加失败测试**（在 `auto_use.test.cjs` 末尾）

```js
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
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm -C packages/engine exec node --test test/auto_use.test.cjs`
Expected: FAIL — `Cannot find module '../src/modules/auto_use/index.js'`

- [ ] **Step 3: 实现** `packages/engine/src/modules/auto_use/index.js`

```js
'use strict';
const { DEFAULT_RULES, matchItem, evaluateRules } = require('./rules');

const USE_BUSY_MS = 1800;       // 一次「使用」占用身体时长（吃/喝约 1.6s + 余量）
const EVAL_INTERVAL_MS = 1000;  // 规则评估节奏

module.exports = (botInstance) => {
  const bot = botInstance.bot;

  const emitLog = (msg) =>
    botInstance.io.to(botInstance._room).to('admin').emit('log', {
      user: bot.username,
      ownerId: botInstance.config.ownerId,
      msg,
      time: new Date().toLocaleTimeString(),
    });

  const task = (botInstance.autoUseTask = {
    active: false,
    rules: [],
    timer: null,
    _timerRef: null,
    cooldowns: {},
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 背包快照：附 isFood 注解，供纯逻辑按「类别=食物」匹配。
  const snapshotItems = () => {
    const mc = botInstance.getMcData && botInstance.getMcData();
    const foods = (mc && mc.foodsByName) || {};
    return bot.inventory.items().map((it) => ({
      name: it.name,
      displayName: it.displayName,
      slot: it.slot,
      count: it.count,
      isFood: !!foods[it.name],
    }));
  };

  // 执行一次「使用」：占身体锁 → 存所选热键 → (潜行) → 装备目标 → 右键 → 等 → 复位。
  const performUse = async (rule, item) => {
    botInstance.setBodyBusy(USE_BUSY_MS);
    const prevQuickBar = bot.quickBarSlot; // 用完切回原选中热键
    const sneak = rule.method === 'sneak_air';
    try {
      // block/entity：交给现有智能分流（自动找方块/生物目标）
      if (rule.method === 'block' || rule.method === 'entity') {
        if (botInstance.useSlot) await botInstance.useSlot(item.slot);
        return;
      }
      const slotItem = bot.inventory.slots[item.slot];
      if (!slotItem) return;
      await bot.equip(slotItem, 'hand');
      if (sneak) bot.setControlState('sneak', true);
      try { bot.activateItem(); } catch (e) { /* ignore */ }
      await sleep(Math.max(0, USE_BUSY_MS - 200));
      try { bot.deactivateItem(); } catch (e) { /* ignore */ }
      if (sneak) bot.setControlState('sneak', false);
      try { if (typeof prevQuickBar === 'number') bot.setQuickBarSlot(prevQuickBar); } catch (e) { /* ignore */ }
    } finally {
      if (sneak) { try { bot.setControlState('sneak', false); } catch (e) { /* ignore */ } }
      if (botInstance.syncInventory) botInstance.syncInventory();
    }
  };

  let running = false; // performUse 是 async，防评估重入
  const evalTick = async () => {
    if (!task.active || !bot || !bot.entity) return;
    if (running) return;
    if (botInstance.isBodyBusy && botInstance.isBodyBusy()) return; // 身体被占用（含自己上一轮）
    running = true;
    try {
      const items = snapshotItems();
      const state = {
        now: Date.now(),
        food: bot.food,
        health: bot.health,
        effects: (bot.entity && bot.entity.effects) || {},
      };
      const hasItem = (rule) => !!matchItem(items, rule.match);
      const rule = evaluateRules(task.rules, state, task.cooldowns, hasItem);
      if (!rule) return;
      const item = matchItem(items, rule.match);
      if (!item) return;
      task.cooldowns[rule.id] = state.now;
      emitLog(`自动使用「${rule.id}」：${item.displayName || item.name}`);
      await performUse(rule, item);
    } catch (e) {
      emitLog(`自动使用异常: ${e && e.message ? e.message : e}`);
    } finally {
      running = false;
    }
  };
  task._evalTick = evalTick; // 暴露给测试手动驱动

  botInstance.toggleAutoUse = (active, config) => {
    task.active = !!active;
    if (config && Array.isArray(config.rules)) task.rules = config.rules;
    else if (!task.rules.length) task.rules = JSON.parse(JSON.stringify(DEFAULT_RULES));

    // 清旧定时器，并从全局 timers 摘掉旧句柄（避免每次 toggle 让数组无限膨胀，参考 code-review MODA-2）
    if (task.timer) { clearInterval(task.timer); task.timer = null; }
    if (Array.isArray(botInstance.timers) && task._timerRef) {
      const i = botInstance.timers.indexOf(task._timerRef);
      if (i >= 0) botInstance.timers.splice(i, 1);
      task._timerRef = null;
    }

    if (task.active) {
      task.timer = setInterval(() => { evalTick().catch(() => {}); }, EVAL_INTERVAL_MS);
      task._timerRef = task.timer;
      botInstance.timers = botInstance.timers || [];
      botInstance.timers.push(task.timer);
      emitLog(`自动使用已开启（${task.rules.length} 条规则）`);
    } else {
      emitLog('自动使用已关闭');
    }
  };

  botInstance.cleanupHooks = botInstance.cleanupHooks || [];
  botInstance.cleanupHooks.push(() => {
    if (task.timer) { clearInterval(task.timer); task.timer = null; }
  });
};
```

- [ ] **Step 4: 运行单测，确认通过**

Run: `pnpm -C packages/engine exec node --test test/auto_use.test.cjs`
Expected: PASS（含新 mock-bot 测试）

- [ ] **Step 5: 注册进 MODULE_NAMES**

在 `packages/engine/src/BotInstance.js:131-136`，把模块清单：
```js
                const MODULE_NAMES = [
                    'combat', 'fishing', 'scheduler', 'player_inventory',
                    'interact', 'automine', 'trash_cleaner', 'auto_farm', 'mob_hunter',
                    'scoreboard', 'script_engine', 'fishing_hotspot', 'window_gui',
                    'custom_js', 'bot_viewer', 'message_monitor',
                ];
```
末尾加 `'auto_use'`：
```js
                const MODULE_NAMES = [
                    'combat', 'fishing', 'scheduler', 'player_inventory',
                    'interact', 'automine', 'trash_cleaner', 'auto_farm', 'mob_hunter',
                    'scoreboard', 'script_engine', 'fishing_hotspot', 'window_gui',
                    'custom_js', 'bot_viewer', 'message_monitor', 'auto_use',
                ];
```

- [ ] **Step 6: 提交**

```bash
git add packages/engine/src/modules/auto_use/index.js packages/engine/src/BotInstance.js packages/engine/test/auto_use.test.cjs
git commit -m "feat(auto-use): factory module (eval loop, performUse, toggle) + register"
```

---

## Task 4: 让其它循环在 bodyBusy 时让位

> 四处都是「在现有 `if (...) return;` 入口守卫后，加一行 bodyBusy 让位」。无新测试（行为在 Task 3 已由 `isBodyBusy` 单测覆盖；这里是接线）。

- [ ] **Step 1: combat.js**

`packages/engine/src/modules/combat.js:16`，把：
```js
        if (!bot || !bot.entity || !botInstance.combatConfig.enabled) return;
```
改为：
```js
        if (!bot || !bot.entity || !botInstance.combatConfig.enabled) return;
        if (botInstance.isBodyBusy && botInstance.isBodyBusy()) return; // 用东西时让位一拍
```

- [ ] **Step 2: automine.js**

`packages/engine/src/modules/automine.js:52`，把：
```js
        if (!task.active || !bot.entity) return;
```
改为：
```js
        if (!task.active || !bot.entity) return;
        if (botInstance.isBodyBusy && botInstance.isBodyBusy()) return; // 用东西时让位一拍
```

- [ ] **Step 3: mob_hunter.js**

`packages/engine/src/modules/mob_hunter.js:453`，把：
```js
        if (!task.active || !bot.entity) return;
```
改为：
```js
        if (!task.active || !bot.entity) return;
        if (botInstance.isBodyBusy && botInstance.isBodyBusy()) return; // 用东西时让位一拍
```

- [ ] **Step 4: auto_farm.js**

`packages/engine/src/modules/auto_farm.js:188`，把：
```js
        if (!botInstance.farmTask.active || !bot.entity) return;
```
改为：
```js
        if (!botInstance.farmTask.active || !bot.entity) return;
        if (botInstance.isBodyBusy && botInstance.isBodyBusy()) return; // 用东西时让位一拍
```

- [ ] **Step 5: typecheck + 单测**

Run: `pnpm -C packages/engine typecheck && pnpm -C packages/engine exec node --test test/auto_use.test.cjs`
Expected: 无类型错误；单测全过

- [ ] **Step 6: 提交**

```bash
git add packages/engine/src/modules/combat.js packages/engine/src/modules/automine.js packages/engine/src/modules/mob_hunter.js packages/engine/src/modules/auto_farm.js
git commit -m "feat(auto-use): yield combat/mine/hunt/farm loops while bodyBusy"
```

---

## Task 5: 协议类型 + 控制面 handlers + 重连恢复

**Files:**
- Modify: `packages/protocol/src/index.ts:75`（加类型）
- Modify: `packages/engine/src/api/moduleHandlers.ts:50-59`（TOGGLE）、`:81-83`（CONFIG）
- Modify: `packages/engine/src/BotInstance.js:229`（restoreModules）

- [ ] **Step 1: 协议加 AutoUseRule + BotSettings.autoUse**

`packages/protocol/src/index.ts`，在 `BotSettings` 接口里找到 `:75`：
```ts
  /** 通用消息监听规则（每服务器可定制的聊天正则统计） */
  monitorRules?: MonitorRule[];
```
其后加一行：
```ts
  /** 自动使用：条件→使用物品（玩家自配规则，auto-eat 为默认规则） */
  autoUse?: { active: boolean; rules?: AutoUseRule[] };
```
再在 `MonitorRule` 接口定义之后（`:108` 那个接口的闭合 `}` 后）新增类型：
```ts

/** 自动使用：一条「条件 → 使用物品」规则 */
export interface AutoUseRule {
  id: string;
  enabled: boolean;
  trigger:
    | { type: "food_below"; value: number }
    | { type: "health_below"; value: number }
    | { type: "effect_missing"; effect: string; minRemainSec?: number }
    | { type: "interval"; everySec: number };
  match: { by: "name" | "category" | "displayName" | "slot"; value: string | number };
  method: "air" | "sneak_air" | "block" | "entity";
  cooldownSec?: number;
}
```

- [ ] **Step 2: MODULE_TOGGLE 加 auto_use 分支**

`packages/engine/src/api/moduleHandlers.ts`，在 `trash_cleaner` case 之后、`default:` 之前（`:56` 与 `:57` 之间）插入：
```ts
          case "auto_use":
            inst.toggleAutoUse?.(active, config || {});
            persistSettings(
              id,
              (s) => ((s as any).autoUse = { active, rules: inst.autoUseTask?.rules || (config && config.rules) || [] }),
            );
            break;
```

- [ ] **Step 3: MODULE_CONFIG 加 auto_use 分支**

同文件，在 `else if (module === "automine")` 块之后（`:83` 的 `}` 之后、`:84` 之前）插入：
```ts
        } else if (module === "auto_use") {
          if (config && Array.isArray(config.rules) && inst.autoUseTask) inst.autoUseTask.rules = config.rules;
          persistSettings(
            id,
            (s) => ((s as any).autoUse = { active: !!inst.autoUseTask?.active, rules: inst.autoUseTask?.rules || [] }),
          );
```

- [ ] **Step 4: restoreModules 加恢复**

`packages/engine/src/BotInstance.js`，在延迟激活块里 `trash_cleaner` 恢复之后（`:229` 那段 `if (settings.trash_cleaner ...) {...}` 的闭合 `}` 之后）插入：
```js
                if (settings.autoUse && this.toggleAutoUse) {
                    const au = settings.autoUse;
                    const active = typeof au === 'object' ? !!au.active : !!au;
                    const cfg = (typeof au === 'object' && Array.isArray(au.rules)) ? { rules: au.rules } : {};
                    if (active) this.toggleAutoUse(true, cfg);
                }
```

- [ ] **Step 5: 构建 + typecheck + 单测**

Run: `pnpm -C packages/protocol build && pnpm -C packages/engine typecheck && pnpm -C packages/engine exec node --test test/auto_use.test.cjs`
Expected: protocol 构建成功；engine 无类型错误（`auto_use`/`autoUse` 引用都解析）；单测全过

- [ ] **Step 6: 提交**

```bash
git add packages/protocol/src/index.ts packages/engine/src/api/moduleHandlers.ts packages/engine/src/BotInstance.js
git commit -m "feat(auto-use): protocol types + toggle/config handlers + reconnect restore"
```

---

## Task 6: 集成验证（构建 + 控制面测试 + 手测冒烟）

- [ ] **Step 1: 全量构建**

Run: `pnpm build`
Expected: protocol + engine + ui 全部构建通过

- [ ] **Step 2: 现有控制面测试不回归**

Run: `pnpm --filter @mcbot/engine test`
Expected: 既有 10 项控制面测试全过（auto_use 注册没破坏启动/鉴权/快照）

- [ ] **Step 3: 单元测试全过**

Run: `pnpm -C packages/engine exec node --test test/auto_use.test.cjs`
Expected: 所有 auto_use 测试 PASS

- [ ] **Step 4: 手测冒烟（需一个可连的 MC 服 + 一个登录的 bot）**

记录到计划备注，不阻断本计划完成（无测试服时跳过，标注「待目标环境」）：
1. 启动引擎，连一个 bot；背包放面包；让饱食度掉到 17 以下（跑动/跳跃）。
2. 通过客户端发 `MODULE_TOGGLE { module: "auto_use", active: true }`。
3. 预期：1~2 秒内 bot 自动吃面包、日志出现「自动使用「auto-eat」：…」，饱食度回升。
4. 边开战斗(combat)边触发吃东西：预期吃的那 ~1.6s 战斗暂停、吃完恢复攻击（验证 bodyBusy 让位）。
5. 重启引擎/断线重连：预期 auto_use 状态与规则恢复（验证持久化 + restoreModules）。

- [ ] **Step 5: 提交（若 Step 4 有微调）**

```bash
git add -A
git commit -m "test(auto-use): integration smoke notes + fixes"
```

---

## 备注 / 后续

- **Plan 2（UI）** 另写：`ModulesTab` 加「自动使用」卡片 + `ModuleConfigDialog` 规则列表编辑器（加/删/改触发类型·物品匹配·使用方式·冷却·单条开关），复用现有字段渲染并补 `hint`。
- v1 的 `method=block/entity` 复用 `botInstance.useSlot(slot)`（自动找方块/生物目标）；如需精确控制目标，留待后续增强。
- **脚本引擎让位**：设计 §4 提到脚本引擎也应在 `bodyBusy` 期间于「步与步之间」让位。本计划 Task 4 只接了 combat/automine/mob_hunter/auto_farm 四个循环（覆盖「边战斗/挖矿/农场/追怪边吃」主场景）；脚本引擎让位需在 `script_engine.js` 的 `executeSteps` 步循环边界加 `while (botInstance.isBodyBusy?.()) await sleep(50)`，因缺该处精确锚点，**留作紧随其后的小补丁**（执行计划时先 grep `executeSteps` 定位再加）。脚本与自动使用并发属较少见组合，不阻断本计划。
- `effect_missing` 的 `effect` 用 mineflayer 的 effect 名（如 `speed`/`regeneration`）；UI 可给下拉。
