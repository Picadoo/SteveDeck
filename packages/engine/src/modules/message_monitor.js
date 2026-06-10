// 通用服务器消息监听统计：用可配置正则规则匹配聊天消息、抽取数值、按方式聚合。
// 通法通解——每个服务器的「金币/经验/灵魂空间…」格式不同，靠规则适配，引擎本身不写死任何服务器。
//
// 规则: { id, label, enabled, pattern(对去色码纯文本匹配,含一个捕获组=值), valueGroup(默认1),
//         numberMode(是否把捕获值解析为数字), agg: sum|count|last|max|rate }
// 统计: ruleId -> { total, count, last, max, firstAt, lastAt }；按 _bid 推送给前端。
// 规则持久化在 settings.monitorRules（跨重启）；统计为本次引擎会话累计，跨「重连」保留、引擎重启或手动重置才清。

const { validatePattern } = require("../utils/safePattern");
const { ServerEvents } = require("@mcbot/protocol"); // 事件名统一走协议常量，杜绝两端字符串漂移

const UNITS = { 千: 1e3, 万: 1e4, 亿: 1e8, 兆: 1e12, 万亿: 1e12, 京: 1e16 };

/** 解析带中文单位/逗号的数字："162.41亿"→1.6241e10  "50.31兆"→5.031e13  "1,500,000"→1500000 */
function parseNum(str) {
  if (str == null) return null;
  const s = String(str).replace(/,/g, "").trim();
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*(万亿|京|千|万|亿|兆)?/);
  if (!m) return null;
  let v = parseFloat(m[1]);
  if (isNaN(v)) return null;
  if (m[2] && UNITS[m[2]]) v *= UNITS[m[2]];
  return v;
}

function stripColor(s) {
  return String(s == null ? "" : s).replace(/§./gi, "");
}

module.exports = (botInstance) => {
  const bot = botInstance.bot;

  // 跨重连保留统计：BotInstance 对象在重连时复用，仅在已存在时不重置（引擎重启/手动 reset 才清）
  botInstance._monitorStats = botInstance._monitorStats || {};

  const loadRules = () => {
    const r = botInstance.config.settings && botInstance.config.settings.monitorRules;
    return Array.isArray(r) ? r : [];
  };
  botInstance._monitorRules = loadRules();

  let compiled = [];
  const compile = () => {
    compiled = botInstance._monitorRules.map((rule) => {
      let re = null;
      // ReDoS 防护(API-3)：不安全/无效正则一律不编译，该规则静默跳过（编辑器侧会提示）
      if (validatePattern(rule.pattern).ok) {
        try {
          re = new RegExp(rule.pattern, "g"); // 全局：一条消息里多个匹配(爆多种材料)都能逐个抓
        } catch (e) {
          re = null;
        }
      }
      return { rule, re };
    });
  };
  compile();

  const ensureStat = (id) => {
    if (!botInstance._monitorStats[id]) {
      botInstance._monitorStats[id] = { total: 0, count: 0, last: null, max: null, firstAt: null, lastAt: null };
    }
    return botInstance._monitorStats[id];
  };

  // 把一次匹配的值累计到某个统计桶（总桶，或某个分类键的桶）
  const applyVal = (bucket, rule, rawVal, val) => {
    bucket.count += 1;
    if (rule.numberMode) {
      if (val != null) {
        bucket.total += val;
        bucket.last = val;
        if (bucket.max == null || val > bucket.max) bucket.max = val;
      }
    } else if (rawVal != null) {
      bucket.last = rawVal;
    }
  };

  let dirty = false;
  const onMessage = (jsonMsg) => {
    let text;
    try {
      text = stripColor(jsonMsg.toString());
    } catch (e) {
      return;
    }
    if (!text) return;
    if (text.length > 1000) text = text.slice(0, 1000); // 限输入长度，缩小回溯最坏开销(API-3 纵深)
    const now = Date.now();
    for (const { rule, re } of compiled) {
      if (!rule.enabled || !re) continue;
      re.lastIndex = 0;
      let m;
      let hit = false;
      let guard = 0;
      try {
        // 全局迭代：一条消息里若爆了多种材料(各类型各数量)，每个匹配都各自计入；按分类键各自分桶
        while ((m = re.exec(text)) !== null) {
          hit = true;
          const st = ensureStat(rule.id);
          st.lastAt = now;
          if (st.firstAt == null) st.firstAt = now;
          const rawVal = m[rule.valueGroup || 1];
          const val = rule.numberMode ? parseNum(rawVal) : null;
          applyVal(st, rule, rawVal, val);
          // 按分类键(如物品名)细分：keyGroup 指定的捕获组作为键，各键各自累计
          if (rule.keyGroup) {
            const keyRaw = m[rule.keyGroup];
            const key = keyRaw != null ? String(keyRaw).trim() : null;
            if (key) {
              st.byKey = st.byKey || {};
              let b = st.byKey[key];
              // E8：键数上限——捕获组是任意聊天片段，长跑可无限造新键（无界内存）。
              // 满 500 后丢弃新键（已有键照常累计；UI 只展示 top30，无感）。
              // 注意不能用 continue 跳过——会绕过循环尾部的零宽/guard 守卫（非全局正则会死循环）。
              if (!b && Object.keys(st.byKey).length < 500) {
                b = st.byKey[key] = { count: 0, total: 0, last: null, max: null };
              }
              if (b) applyVal(b, rule, rawVal, val);
            }
          }
          if (!re.global) break; // 非全局只处理一次
          if (m.index === re.lastIndex) re.lastIndex++; // 防零宽匹配死循环
          if (++guard > 500) break; // 安全上限
        }
      } catch (e) {
        continue;
      }
      if (hit) dirty = true;
    }
  };
  bot.on("message", onMessage);

  const buildStatsPayload = () => {
    const out = {};
    const now = Date.now();
    for (const rule of botInstance._monitorRules) {
      const st = botInstance._monitorStats[rule.id];
      if (!st) {
        out[rule.id] = { count: 0, total: 0, last: null, max: null, perMin: 0 };
        continue;
      }
      const mins = st.firstAt ? Math.max(1 / 60, (now - st.firstAt) / 60000) : 0;
      const payload = {
        count: st.count,
        total: st.total,
        last: st.last,
        max: st.max,
        perMin: mins > 0 ? (rule.agg === "count" ? st.count / mins : st.total / mins) : 0,
      };
      if (st.byKey) {
        // 按 total(数字模式)/count 降序，取前 30 键，控制推送体积
        const entries = Object.entries(st.byKey).sort(
          (a, b) => b[1].total - a[1].total || b[1].count - a[1].count,
        );
        payload.byKey = {};
        for (const [k, v] of entries.slice(0, 30)) payload.byKey[k] = v;
      }
      out[rule.id] = payload;
    }
    return out;
  };

  const pushStats = () => {
    botInstance.io.to(botInstance._room).to("admin").emit(ServerEvents.MONITOR_STATS, {
      user: bot.username,
      ownerId: botInstance.config.ownerId,
      stats: buildStatsPayload(),
    });
  };

  // 节流推送（1.5s 内有匹配才推一次）。
  // MODB-11：无人观看时跳过这一拍的「构造 payload + 广播」重活——统计仍在 onMessage 里照常累计(_monitorStats，
  // 跨重连保留)，dirty 保持置位，待有人看时下一拍即把最新累计值补推；getMonitor() 也随时按需返回当前值。
  const pushTimer = setInterval(() => {
    if (dirty && botInstance.hasWatchers()) {
      dirty = false;
      pushStats();
    }
  }, 1500);
  botInstance.timers = botInstance.timers || [];
  botInstance.timers.push(pushTimer);

  // ===== 对外 API =====
  botInstance.getMonitor = () => ({ rules: botInstance._monitorRules, stats: buildStatsPayload() });

  botInstance.setMonitorRules = (rules) => {
    botInstance._monitorRules = Array.isArray(rules) ? rules : [];
    compile();
    // 清掉已删除规则的统计
    const ids = new Set(botInstance._monitorRules.map((r) => r.id));
    for (const id of Object.keys(botInstance._monitorStats)) {
      if (!ids.has(id)) delete botInstance._monitorStats[id];
    }
    botInstance.config.settings = botInstance.config.settings || {};
    botInstance.config.settings.monitorRules = botInstance._monitorRules;
    if (typeof botInstance.saveConfig === "function") botInstance.saveConfig();
    pushStats();
    return botInstance.getMonitor();
  };

  botInstance.resetMonitorStats = () => {
    botInstance._monitorStats = {};
    pushStats();
    return botInstance.getMonitor();
  };

  // 测试匹配：给一条样例消息，返回是否命中 + 捕获值 + 解析后的数字
  botInstance.testMonitorRule = (pattern, valueGroup, numberMode, sample) => {
    const safe = validatePattern(pattern); // ReDoS 防护(API-3)：测试入口同样拦不安全正则
    if (!safe.ok) return { ok: false, error: safe.error };
    let re;
    try {
      re = new RegExp(pattern);
    } catch (e) {
      return { ok: false, error: "正则无效: " + e.message };
    }
    const text = stripColor(sample || "");
    let m;
    try {
      m = re.exec(text);
    } catch (e) {
      return { ok: false, error: "匹配出错: " + e.message };
    }
    if (!m) return { ok: true, matched: false };
    const rawVal = m[valueGroup || 1];
    return { ok: true, matched: true, group: rawVal ?? null, value: numberMode ? parseNum(rawVal) : null };
  };

  botInstance.cleanupHooks = botInstance.cleanupHooks || [];
  botInstance.cleanupHooks.push(() => {
    bot.removeListener("message", onMessage);
    clearInterval(pushTimer);
  });
};
