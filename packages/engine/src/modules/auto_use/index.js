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

  // effects 适配（关键修复）：mineflayer 的 entity.effects 按「数字 effect id」键，而纯规则按「效果名」查。
  // 这里用 mcData.effects[id].name 把它转成 { speed: {duration,amplifier}, ... }（小写名），否则
  // effect_missing 永远查不到 → 误判「缺」→ 冷却一到就狂用 buff 物品。
  const effectsByName = () => {
    const out = {};
    const raw = (bot.entity && bot.entity.effects) || {};
    const mc = botInstance.getMcData && botInstance.getMcData();
    const meta = (mc && mc.effects) || {};
    for (const key of Object.keys(raw)) {
      const e = raw[key];
      if (!e) continue;
      const id = e.id != null ? e.id : Number(key);
      const m = meta[id];
      const name = m && m.name ? String(m.name).toLowerCase() : String(id);
      out[name] = { duration: e.duration, amplifier: e.amplifier };
    }
    return out;
  };
  task._effectsByName = effectsByName; // 暴露给单测

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
        effects: effectsByName(), // 已转成按名字键
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
