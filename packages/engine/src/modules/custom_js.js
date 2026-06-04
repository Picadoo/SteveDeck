// 原生 JS 自定义脚本运行时：高级用户用文档化的 bot API 写真正的 JS，运行时加载执行。
// 仅在 ENGINE_ALLOW_JS !== '0' 时开放（见 moduleHandlers 网关）。

const { goals, Movements } = require("mineflayer-pathfinder");
const vec3 = require("vec3");

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

module.exports = (botInstance) => {
  const bot = botInstance.bot;

  const emitLog = (msg) =>
    botInstance.io
      .to(botInstance._room)
      .to("admin")
      .emit("log", {
        user: bot.username,
        ownerId: botInstance.config.ownerId,
        msg: `[JS] ${msg}`,
        time: new Date().toLocaleTimeString(),
      });

  let state = null; // { name, cancelled }

  function buildApi(st) {
    return {
      bot,
      mineflayer: require("mineflayer"),
      Vec3: vec3.Vec3 || vec3,
      goals,
      log: (...a) =>
        emitLog(a.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" ")),
      chat: (msg) => bot.chat(String(msg)),
      sleep: (ms) => new Promise((r) => setTimeout(r, Math.max(0, Math.min(Number(ms) || 0, 600000)))),
      get stopped() {
        return st.cancelled;
      },
      pos: () => (bot.entity ? bot.entity.position.clone() : null),
      health: () => ({ health: bot.health, food: bot.food }),
      observe: () => require("../ai/observe").buildObservation(botInstance.config.id),
      goto: (x, y, z, range = 1) =>
        new Promise((resolve) => {
          try {
            // 复用实例的「无破坏模式」策略（受保护地图不挖不搭）；老实例回退默认
            const mv =
              typeof botInstance.makeMovements === "function"
                ? botInstance.makeMovements()
                : new Movements(bot, botInstance.getMcData());
            bot.pathfinder.setMovements(mv);
            bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, range));
            const done = () => {
              bot.removeListener("goal_reached", done);
              resolve(true);
            };
            bot.once("goal_reached", done);
          } catch (e) {
            resolve(false);
          }
        }),
      stopGoto: () => {
        try {
          bot.pathfinder.setGoal(null);
        } catch {
          /* ignore */
        }
      },
      // 容器 / GUI
      openContainer: (x, y, z) => botInstance.openContainerAt(x, y, z),
      clickSlot: (slot, button = 0, mode = 0) => botInstance.clickWindowSlot(slot, button, mode),
      closeWindow: () => botInstance.closeGui(),
      window: () => botInstance.getWindow(),
    };
  }

  /** 运行一段自定义 JS。code 体内可 await，可用 api/bot/log/sleep/chat/Vec3/require。 */
  botInstance.runCustomJs = (name, code) => {
    botInstance.stopCustomJs();
    const st = { name: name || "未命名脚本", cancelled: false };
    state = st;
    botInstance._customJs = st;
    emitLog(`运行「${st.name}」`);

    let fn;
    try {
      fn = new AsyncFunction("api", "bot", "log", "sleep", "chat", "Vec3", "require", code);
    } catch (e) {
      emitLog(`语法错误: ${e.message}`);
      state = null;
      botInstance._customJs = null;
      return { ok: false, error: e.message };
    }

    const api = buildApi(st);
    Promise.resolve()
      .then(() => fn(api, bot, api.log, api.sleep, api.chat, api.Vec3, require))
      .then(() => {
        if (!st.cancelled) emitLog(`「${st.name}」结束`);
      })
      .catch((e) => emitLog(`错误: ${e && e.message ? e.message : e}`))
      .finally(() => {
        if (state === st) {
          state = null;
          botInstance._customJs = null;
        }
      });
    return { ok: true };
  };

  botInstance.stopCustomJs = () => {
    if (!state) return false;
    state.cancelled = true;
    emitLog(`停止「${state.name}」`);
    try {
      bot.pathfinder.setGoal(null);
    } catch {
      /* ignore */
    }
    state = null;
    botInstance._customJs = null;
    return true;
  };

  // 断线时取消运行
  botInstance.cleanupHooks = botInstance.cleanupHooks || [];
  botInstance.cleanupHooks.push(() => {
    if (state) state.cancelled = true;
    state = null;
    botInstance._customJs = null;
  });
};
