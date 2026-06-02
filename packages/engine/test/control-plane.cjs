/* Phase 1 控制面端到端验证：令牌鉴权 + 增删机器人 + 快照 + 模块开关 + /health。
   不依赖真实 MC 服务器（机器人会保持离线，验证的是管理/API/鉴权层）。 */
const path = require("path");
const os = require("os");
process.env.MCBOT_DATA_DIR = path.join(os.tmpdir(), "mcbot-test-" + Date.now());

const { io } = require("socket.io-client");
const { startEngine } = require("../dist/index.js");

const TOKEN = "testtoken123";
const PORT = 8799;
const URL = `http://127.0.0.1:${PORT}`;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
function emitAck(client, ev, payload) {
  return new Promise((res) => {
    let done = false;
    client.emit(ev, payload, (r) => { done = true; res(r); });
    setTimeout(() => { if (!done) res(null); }, 4000);
  });
}

(async () => {
  const engine = await startEngine({ port: PORT, token: TOKEN });
  let failures = 0;
  const check = (name, cond) => {
    if (cond) console.log("  ✓", name);
    else { console.error("  ✗", name); failures++; }
  };

  // 1. 错误令牌应被拒绝
  await new Promise((resolve) => {
    const bad = io(URL, { auth: { token: "wrong" }, reconnection: false });
    bad.on("connect", () => { check("拒绝错误令牌", false); bad.close(); resolve(); });
    bad.on("connect_error", () => { check("拒绝错误令牌", true); bad.close(); resolve(); });
    setTimeout(resolve, 3000);
  });

  // 2. 正确令牌连接 + 收到 engine:info 与初始快照
  const client = io(URL, { auth: { token: TOKEN }, reconnection: false });
  const got = {};
  client.on("engine:info", (p) => (got.info = p));
  client.on("bots:snapshot", (p) => (got.snapshot = p));
  await new Promise((res) => { client.on("connect", res); client.on("connect_error", res); setTimeout(res, 3000); });
  check("正确令牌可连接", client.connected);
  await delay(400);
  check("收到 engine:info (protocolVersion=1)", !!got.info && got.info.protocolVersion === 1);
  check("收到初始 bots:snapshot", !!got.snapshot && Array.isArray(got.snapshot.bots));

  // 3. 添加机器人
  const addRes = await emitAck(client, "bot:add", {
    username: "TestBot", host: "127.0.0.1", port: 25565, version: "1.20.1",
  });
  check("bot:add 返回 ok + id", !!addRes && addRes.ok === true && !!addRes.data && !!addRes.data.id);
  const id = addRes && addRes.data && addRes.data.id;
  await delay(500);
  check("快照含新机器人(离线)", !!got.snapshot && got.snapshot.bots.some((b) => b.username === "TestBot" && b.online === false));

  // 4. 重复添加应失败
  const dupRes = await emitAck(client, "bot:add", { username: "TestBot", host: "127.0.0.1" });
  check("重复添加被拒绝", !!dupRes && dupRes.ok === false);

  // 5. 开启战斗模块
  const tog = await emitAck(client, "module:toggle", { id, module: "combat", active: true });
  check("开启战斗模块 ok", !!tog && tog.ok === true);

  // 6. 已接入模块(自动挖矿)可切换；未知模块应返回错误
  const mineToggle = await emitAck(client, "module:toggle", { id, module: "automine", active: false });
  check("自动挖矿模块已接入", !!mineToggle && mineToggle.ok === true);
  const unknown = await emitAck(client, "module:toggle", { id, module: "bogus_module", active: true });
  check("未知模块返回错误", !!unknown && unknown.ok === false);

  // 7. 删除机器人
  const del = await emitAck(client, "bot:delete", { id });
  check("bot:delete ok", !!del && del.ok === true);
  await delay(400);
  check("删除后快照为空", !!got.snapshot && got.snapshot.bots.length === 0);

  // 8. /health
  try {
    const h = await fetch(URL + "/health").then((r) => r.json());
    check("/health 返回 ok", h.status === "ok" && h.version === "0.1.0");
  } catch (e) {
    check("/health 返回 ok", false);
  }

  // 9. /api/bots 需令牌
  try {
    const unauth = await fetch(URL + "/api/bots");
    check("/api/bots 无令牌返回 401", unauth.status === 401);
    const authed = await fetch(URL + "/api/bots", { headers: { Authorization: "Bearer " + TOKEN } });
    check("/api/bots 带令牌返回 200", authed.status === 200);
  } catch (e) {
    check("/api/bots 鉴权", false);
  }

  client.close();
  engine.server.close();
  await delay(200);
  console.log(failures === 0 ? "\nALL PASS ✅" : `\n${failures} FAIL ❌`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
