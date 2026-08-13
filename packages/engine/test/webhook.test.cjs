/* Webhook 挂机通知单测：各平台请求体格式、配置 sanitize、冷却去重。
   纯逻辑测试（fetch 打桩），不发真实网络请求。需先 pnpm build（测编译产物 dist/）。 */
const path = require("path");
const os = require("os");
process.env.MCBOT_DATA_DIR = path.join(os.tmpdir(), `mcbot-notify-test-${Date.now()}`);

const test = require("node:test");
const assert = require("node:assert");
const wh = require("../dist/notify/webhook.js");

test("buildRequest：各平台请求体格式不被改坏", () => {
  const evt = { kind: "death", botId: "b1", username: "Steve", host: "mc.example.com", message: "死亡，正在自动复活" };

  const ding = wh.buildRequest("dingtalk", "https://x/hook", evt);
  const dingBody = JSON.parse(ding.init.body);
  assert.equal(dingBody.msgtype, "text");
  assert.ok(dingBody.text.content.includes("SteveDeck"), "钉钉正文须含 SteveDeck 前缀（用户拿它配关键词过滤）");
  assert.ok(dingBody.text.content.includes("Steve@mc.example.com"));

  const feishu = JSON.parse(wh.buildRequest("feishu", "https://x", evt).init.body);
  assert.equal(feishu.msg_type, "text");
  assert.ok(feishu.content.text.includes("Steve"));

  const wecom = JSON.parse(wh.buildRequest("wecom", "https://x", evt).init.body);
  assert.equal(wecom.msgtype, "text");

  const discord = JSON.parse(wh.buildRequest("discord", "https://x", evt).init.body);
  assert.ok(discord.content.includes("Steve"));

  const sc = wh.buildRequest("serverchan", "https://x", evt);
  assert.equal(sc.init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.ok(/^title=.+&desp=.+/.test(sc.init.body), "Server酱走表单 title/desp");

  const bark = JSON.parse(wh.buildRequest("bark", "https://x", evt).init.body);
  assert.ok(bark.title && bark.body);

  const gen = JSON.parse(wh.buildRequest("generic", "https://x", evt).init.body);
  assert.equal(gen.source, "stevedeck");
  assert.equal(gen.kind, "death");
  assert.equal(gen.bot.username, "Steve");
});

test("配置 sanitize：非法 URL / 未知预设 / 越界冷却被收口", () => {
  const saved = wh.saveNotifyConfig({
    enabled: true,
    url: "javascript:alert(1)",
    preset: "hack",
    cooldownSec: 99999,
  });
  assert.equal(saved.url, "", "非 http(s) 地址必须拒收");
  assert.equal(saved.preset, "generic");
  assert.equal(saved.cooldownSec, 3600, "冷却上限 1 小时");

  const saved2 = wh.saveNotifyConfig({ url: "https://ok.example/hook", cooldownSec: 30 });
  assert.equal(saved2.url, "https://ok.example/hook");
  assert.equal(saved2.cooldownSec, 30);
  assert.equal(saved2.enabled, true, "未传的键保留旧值（增量 patch 语义）");
  assert.equal(wh.loadNotifyConfig().url, "https://ok.example/hook", "落盘后可读回");
});

test("publishBotEvent：冷却窗内同 bot 同类事件只发一次；关闭的事件类型不发", async () => {
  const calls = [];
  const origFetch = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200 };
  };
  try {
    wh.saveNotifyConfig({
      enabled: true,
      url: "https://ok.example/hook",
      preset: "generic",
      cooldownSec: 60,
      events: { death: true, kick: true, offline: true, online: false },
    });
    wh.publishBotEvent({ kind: "death", botId: "b1", username: "Steve", message: "死亡" });
    wh.publishBotEvent({ kind: "death", botId: "b1", username: "Steve", message: "又死了" }); // 冷却内，应被吞
    wh.publishBotEvent({ kind: "death", botId: "b2", username: "Alex", message: "死亡" }); // 不同 bot，应放行
    wh.publishBotEvent({ kind: "online", botId: "b1", username: "Steve", message: "上线" }); // online 关着，应被吞
    wh.publishBotEvent({ kind: "watch", botId: "b1", username: "Steve", message: "命中" }); // watch 默认关，应被吞
    await new Promise((r) => setTimeout(r, 50)); // fire-and-forget 的微任务落地
    assert.equal(calls.length, 2);
  } finally {
    global.fetch = origFetch;
  }
});

test("watch（盯人命中）事件：默认关闭，显式开启后推送且带正确标签", async () => {
  const calls = [];
  const origFetch = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200 };
  };
  try {
    assert.equal(wh.loadNotifyConfig().events.watch, false, "watch 必须默认关（聊天可能高频）");
    wh.saveNotifyConfig({ events: { watch: true } });
    wh.publishBotEvent({ kind: "watch", botId: "b3", username: "Steve", message: "Alex：出售钻石" });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls.length, 1);
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.kind, "watch");
    assert.ok(body.title.includes("盯人命中"));
  } finally {
    global.fetch = origFetch;
  }
});
