// 通用服务器消息监听统计：用可配置正则规则匹配聊天消息、抽取数值、按方式聚合。
// 通法通解——每个服务器的「金币/经验/灵魂空间…」格式不同，靠规则适配，引擎本身不写死任何服务器。
//
// 规则: { id, label, enabled, pattern(对去色码纯文本匹配,含一个捕获组=值), valueGroup(默认1),
//         numberMode(是否把捕获值解析为数字), agg: sum|count|last|max|rate }
// 统计: ruleId -> { total, count, last, max, firstAt, lastAt }；按 _bid 推送给前端。
// 规则持久化在 settings.monitorRules（跨重启）；统计为本次引擎会话累计，跨「重连」保留、引擎重启或手动重置才清。

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
  return String(s == null ? "" : s).replace(/§[0-9a-fk-orx]/gi, "");
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
      try {
        re = new RegExp(rule.pattern);
      } catch (e) {
        re = null; // 正则无效则跳过（编辑器侧会提示）
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

  let dirty = false;
  const onMessage = (jsonMsg) => {
    let text;
    try {
      text = stripColor(jsonMsg.toString());
    } catch (e) {
      return;
    }
    if (!text) return;
    const now = Date.now();
    for (const { rule, re } of compiled) {
      if (!rule.enabled || !re) continue;
      let m;
      try {
        m = re.exec(text);
      } catch (e) {
        continue;
      }
      if (!m) continue;
      const st = ensureStat(rule.id);
      st.count += 1;
      st.lastAt = now;
      if (st.firstAt == null) st.firstAt = now;
      const rawVal = m[rule.valueGroup || 1];
      if (rule.numberMode) {
        const val = parseNum(rawVal);
        if (val != null) {
          st.total += val;
          st.last = val;
          if (st.max == null || val > st.max) st.max = val;
        }
      } else if (rawVal != null) {
        st.last = rawVal; // 非数字模式：last 存匹配到的文本
      }
      dirty = true;
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
      out[rule.id] = {
        count: st.count,
        total: st.total,
        last: st.last,
        max: st.max,
        perMin: mins > 0 ? (rule.agg === "count" ? st.count / mins : st.total / mins) : 0,
      };
    }
    return out;
  };

  const pushStats = () => {
    botInstance.io.to(botInstance._room).to("admin").emit("monitor_stats", {
      user: bot.username,
      ownerId: botInstance.config.ownerId,
      stats: buildStatsPayload(),
    });
  };

  // 节流推送（1.5s 内有匹配才推一次）
  const pushTimer = setInterval(() => {
    if (dirty) {
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
