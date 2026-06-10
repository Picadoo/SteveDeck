import { io, type Socket } from "socket.io-client";
import {
  ServerEvents,
  ClientCommands,
  type HandshakeAuth,
  type CommandAck,
  type BotConfigInput,
  type BotSummary,
  type BotStatus,
  type LogLine,
  type ScriptSummary,
  type BotScript,
  type InventoryItem,
  type Observation,
  type WindowState,
  type MonitorRule,
  type MonitorStat,
  type DataBundle,
} from "@mcbot/protocol";
import { useStore } from "@/store/useStore";

let socket: Socket | null = null;
const LS_KEY = "mcbot.connection";

function now(): string {
  return new Date().toLocaleTimeString();
}

export function loadSaved(): { url: string; token: string } | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj?.url && obj?.token) return obj;
  } catch {
    /* ignore */
  }
  return null;
}

function saveConn(url: string, token: string): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ url, token }));
  } catch {
    /* ignore */
  }
}

export function forgetConn(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

/** 拉取引擎连接信息（地址/连接串/二维码），用于「扫码连接其他设备」。 */
export async function fetchConnectionInfo(): Promise<{
  addresses: string[];
  port: number;
  connectionString: string;
  qrcodeDataUrl?: string;
} | null> {
  const { url, token } = useStore.getState().conn;
  if (!url || !token) return null;
  try {
    const r = await fetch(url + "/api/connection-info", {
      headers: { Authorization: "Bearer " + token },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/** 解析连接串 mcbot://host:port?token=xxx → { url, token } */
export function parseConnectionString(input: string): { url: string; token: string } | null {
  const s = input.trim();
  const m = s.match(/^mcbot:\/\/([^/?#]+)(?:\?token=(.+))?$/i);
  if (m) {
    const host = m[1];
    const token = decodeURIComponent(m[2] ?? "");
    return { url: `http://${host}`, token };
  }
  return null;
}

export function normalizeUrl(addr: string): string {
  let a = addr.trim();
  if (!/^https?:\/\//i.test(a)) a = "http://" + a;
  return a.replace(/\/+$/, "");
}

// 连接世代(UICORE-2)：每次 disconnect() +1。tryTauriAutoConnect 在 ~20s 轮询前后比对，
// 若期间用户手动断开/切走，则放弃这次自动连接，避免复活已被拆除的连接。
let connectEpoch = 0;

/**
 * 桌面内置版：在 Tauri 壳内向 Rust 取内置引擎地址+令牌，等引擎就绪后自动连接。
 * 返回 true 表示处于「内置引擎」流程（调用方不再回退到保存的远程连接）；
 * 非 Tauri 环境（网页/移动浏览器）或内置引擎不可用时返回 false。
 */
export async function tryTauriAutoConnect(): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoke = (globalThis as any)?.__TAURI__?.core?.invoke;
  if (typeof invoke !== "function") return false; // 非 Tauri 环境
  let info: { url?: string; token?: string } | undefined;
  try {
    info = (await invoke("engine_info")) as { url?: string; token?: string };
  } catch {
    return false; // 内置引擎未起/命令缺失 → 交回退处理
  }
  if (!info?.url || !info?.token) return false;
  const myEpoch = connectEpoch; // UICORE-2：记录世代，轮询期间被 disconnect 打断则放弃
  useStore.getState().setConn({ status: "connecting", error: undefined });
  // 内置引擎刚启动需 1~3s，轮询 /health 最多等 ~20s，就绪即连
  let ready = false;
  for (let i = 0; i < 40; i++) {
    if (connectEpoch !== myEpoch) return false; // 期间用户手动断开/切走 → 不再连
    try {
      const r = await fetch(info.url + "/health", { cache: "no-store" });
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {
      /* 还没起来，继续等 */
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  if (connectEpoch !== myEpoch) return false; // 最终连接前再确认一次
  // 轮询 ~20s 仍未就绪：内置引擎大概率启动失败。给出明确信号（错误态 + 提示），
  // 否则 App 只会静默回退到手动连接界面，用户不知道为什么。仍返回 true 以阻止回退到「上次保存的远程连接」。
  if (!ready) {
    const msg = "内置引擎未能启动，请检查安装或手动连接";
    useStore.getState().setConn({ status: "error", error: msg });
    useStore.getState().pushToast(msg, "error");
    return true;
  }
  connect(info.url, info.token);
  return true;
}

// ===== Tauri 桥（桌面内置/远程引擎来源切换）=====
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tauriInvoke(): ((cmd: string, args?: any) => Promise<any>) | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inv = (globalThis as any)?.__TAURI__?.core?.invoke;
  return typeof inv === "function" ? inv : null;
}

/** 是否运行在 Tauri 桌面壳内 */
export function isTauri(): boolean {
  return tauriInvoke() !== null;
}

/** 读引擎来源配置（内置/远程）；非 Tauri 返回 null */
export async function getEngineConfig(): Promise<{ mode: string; url: string; token: string } | null> {
  const inv = tauriInvoke();
  if (!inv) return null;
  try {
    return (await inv("get_engine_config")) as { mode: string; url: string; token: string };
  } catch {
    return null;
  }
}

/** 写引擎来源配置（重启后生效） */
export async function setEngineConfig(mode: string, url: string, token: string): Promise<boolean> {
  const inv = tauriInvoke();
  if (!inv) return false;
  try {
    await inv("set_engine_config", { mode, url, token });
    return true;
  } catch {
    return false;
  }
}

/** 重启桌面应用（切换引擎来源后生效） */
export async function restartApp(): Promise<void> {
  const inv = tauriInvoke();
  if (!inv) return;
  try {
    await inv("restart_app");
  } catch {
    /* ignore */
  }
}

export function connect(url: string, token: string): void {
  disconnect();
  const setConn = useStore.getState().setConn;
  setConn({ status: "connecting", url, token, error: undefined });

  socket = io(url, {
    auth: { token } as HandshakeAuth,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
    timeout: 8000,
    transports: ["websocket", "polling"],
  });

  socket.on("connect", () => {
    setConn({ status: "online", error: undefined });
    saveConn(url, token);
  });
  socket.on("connect_error", (e: Error) => {
    const msg = e?.message === "unauthorized" ? "访问令牌不正确" : e?.message || "连接失败";
    setConn({ status: "error", error: msg });
  });
  socket.on("disconnect", () => {
    if (useStore.getState().conn.status === "online") setConn({ status: "connecting" });
  });

  socket.on(ServerEvents.ENGINE_INFO, (p: { version: string; protocolVersion: number }) =>
    setConn({ engine: p }),
  );
  socket.on(ServerEvents.BOTS_SNAPSHOT, (p: { bots: BotSummary[] }) =>
    useStore.getState().setBots(p.bots ?? []),
  );
  socket.on(ServerEvents.BOT_STATUS, (p: { bot: BotStatus }) =>
    useStore.getState().upsertBot(p.bot),
  );
  socket.on(ServerEvents.BOT_DELETED, (p: { id: string }) => useStore.getState().removeBot(p.id));
  socket.on(ServerEvents.BOT_LOG, (p: { id: string; line: LogLine }) => {
    if (p.id) useStore.getState().appendLog(p.id, p.line);
  });
  socket.on(ServerEvents.BOT_ERROR, (p: { id: string; error: string }) => {
    if (p.id) useStore.getState().appendLog(p.id, { time: now(), text: p.error, level: "error" });
  });
  // 按实例 ID(_bid) 归档，避免同名机器人（不同服务器）串台；老引擎无 _bid 时回退用户名
  socket.on(ServerEvents.INVENTORY, (p: { user: string; _bid?: string; items: InventoryItem[] }) => {
    const key = p._bid || p.user;
    if (key) useStore.getState().setInventory(key, p.items || []);
  });
  socket.on(ServerEvents.WINDOW_OPEN, (p: { user: string; _bid?: string; window: WindowState }) => {
    const key = p._bid || p.user;
    if (key) useStore.getState().setWindow(key, p.window);
  });
  socket.on(ServerEvents.WINDOW_CLOSE, (p: { user: string; _bid?: string }) => {
    const key = p._bid || p.user;
    if (key) useStore.getState().setWindow(key, null);
  });
  // 原地刷新：菜单点击/翻页后服务端更新了槽位但未重开窗口
  socket.on(ServerEvents.WINDOW_UPDATE, (p: { user: string; _bid?: string; window: WindowState }) => {
    const key = p._bid || p.user;
    if (key) useStore.getState().setWindow(key, p.window);
  });

  // 脚本运行时反馈（进度/状态/报错/变量）——以前完全没订阅，脚本对用户是黑盒
  socket.on(
    ServerEvents.SCRIPT_STATUS,
    (p: { _bid?: string; user?: string; name?: string; status?: string; detail?: string }) => {
      const key = p._bid || p.user;
      if (!key) return;
      const patch: Record<string, unknown> = { name: p.name, status: p.status, detail: p.detail };
      // 新一轮开始：清掉上次的报错与进度
      if (p.status === "running") {
        patch.error = null;
        patch.action = undefined;
        patch.path = undefined;
      }
      useStore.getState().mergeScriptRuntime(key, patch);
    },
  );
  socket.on(
    ServerEvents.SCRIPT_PROGRESS,
    (p: { _bid?: string; user?: string; path?: string; action?: string; loopIter?: number }) => {
      const key = p._bid || p.user;
      if (key) useStore.getState().mergeScriptRuntime(key, { path: p.path, action: p.action, loopIter: p.loopIter });
    },
  );
  socket.on(
    ServerEvents.SCRIPT_ERROR,
    (p: { _bid?: string; user?: string; path?: string; action?: string; message?: string }) => {
      const key = p._bid || p.user;
      if (!key) return;
      const message = p.message || "未知错误";
      useStore.getState().mergeScriptRuntime(key, { error: { path: p.path, action: p.action, message, time: now() } });
      useStore.getState().pushToast(`脚本错误：${message}`, "error");
    },
  );
  socket.on(ServerEvents.SCRIPT_VARS, (p: { _bid?: string; user?: string; vars?: Record<string, unknown> }) => {
    const key = p._bid || p.user;
    if (key) useStore.getState().mergeScriptRuntime(key, { vars: p.vars || {} });
  });
  // 通用消息监听统计
  socket.on(
    ServerEvents.MONITOR_STATS,
    (p: { _bid?: string; user?: string; stats?: Record<string, MonitorStat> }) => {
      const key = p._bid || p.user;
      if (key) useStore.getState().setMonitorStats(key, p.stats || {});
    },
  );
}

export function disconnect(): void {
  connectEpoch++; // UICORE-2：打断在途的自动连接
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  // UICORE-8：断开/切换引擎即清 per-bot 映射，防新引擎 id 偶同导致串显旧引擎数据。
  // 仅在显式 disconnect()/connect() 触发（socket.io 的瞬时重连不走这里），故网络抖动不丢日志。
  useStore.getState().resetSession();
  useStore.getState().setConn({ status: "disconnected" });
}

function emitAck<T = unknown>(event: string, payload: unknown, timeoutMs = 8000): Promise<CommandAck<T>> {
  return new Promise((resolve) => {
    if (!socket || !socket.connected) {
      resolve({ ok: false, error: "未连接到引擎" });
      return;
    }
    socket
      .timeout(timeoutMs)
      .emit(event, payload, (err: unknown, res: CommandAck<T>) => {
        if (err) resolve({ ok: false, error: "请求超时" });
        else resolve(res);
      });
  });
}

export const cmd = {
  addBot: (input: BotConfigInput) => emitAck<{ id: string }>(ClientCommands.BOT_ADD, input),
  deleteBot: (id: string) => emitAck(ClientCommands.BOT_DELETE, { id }),
  updateBot: (id: string, patch: Partial<BotConfigInput>) =>
    emitAck(ClientCommands.BOT_UPDATE, { id, patch }),
  getBotConfig: (id: string) =>
    emitAck<{
      username: string;
      host: string;
      port: number;
      version: string;
      hasLoginPassword?: boolean; // 不回传明文密码（API-10）：仅告知是否已存，编辑态据此显示占位
      note?: string;
      settings: any;
    }>(ClientCommands.BOT_CONFIG, { id }),
  reconnect: (id: string) => emitAck(ClientCommands.BOT_RECONNECT, { id }),
  stop: (id: string) => emitAck(ClientCommands.BOT_STOP, { id }),
  chat: (id: string, message: string) => emitAck(ClientCommands.BOT_CHAT, { id, message }),
  toggleModule: (id: string, module: string, active: boolean, config?: Record<string, unknown>) =>
    emitAck(ClientCommands.MODULE_TOGGLE, { id, module, active, config }),
  configModule: (id: string, module: string, config: Record<string, unknown>) =>
    emitAck(ClientCommands.MODULE_CONFIG, { id, module, config }),
  exportData: () => emitAck<DataBundle>(ClientCommands.DATA_EXPORT, {}),
  importData: (bundle: unknown) =>
    emitAck<{ bots: number; scripts: number; customScripts: number }>(ClientCommands.DATA_IMPORT, { bundle }),
  moduleAction: <T = unknown>(id: string, module: string, action: string, args?: Record<string, unknown>) =>
    emitAck<T>(ClientCommands.MODULE_ACTION, { id, module, action, args }),
  script: {
    list: (id?: string) => emitAck<ScriptSummary[]>(ClientCommands.SCRIPT_LIST, { id }),
    detail: (name: string) => emitAck<BotScript | null>(ClientCommands.SCRIPT_DETAIL, { name }),
    save: (script: BotScript) => emitAck(ClientCommands.SCRIPT_SAVE, { script }),
    remove: (name: string) => emitAck(ClientCommands.SCRIPT_DELETE, { name }),
    start: (id: string, name: string) => emitAck(ClientCommands.SCRIPT_START, { id, name }),
    stop: (id: string) => emitAck(ClientCommands.SCRIPT_STOP, { id }),
  },
  observe: (id: string) => emitAck<Observation>(ClientCommands.AI_OBSERVE, { id }),
  window: {
    get: (id: string) =>
      emitAck<WindowState | null>(ClientCommands.MODULE_ACTION, { id, module: "window", action: "get" }),
    click: (id: string, slot: number, button = 0, mode = 0) =>
      emitAck<WindowState | null>(ClientCommands.MODULE_ACTION, {
        id,
        module: "window",
        action: "click",
        args: { slot, button, mode },
      }),
    close: (id: string) =>
      emitAck(ClientCommands.MODULE_ACTION, { id, module: "window", action: "close" }),
    openAt: (id: string, x: number, y: number, z: number) =>
      // 开远处箱子要先寻路走过去（引擎侧寻路超时 15s）：默认 8s ack 会在机器人还在走时
      // 误报「请求超时」——给 30s，覆盖寻路+开箱全程
      emitAck<WindowState | null>(
        ClientCommands.MODULE_ACTION,
        { id, module: "window", action: "openAt", args: { x, y, z } },
        30000,
      ),
    explore: (id: string, item: string, clickPath?: string[]) =>
      emitAck<{ usedItem: string; trail?: { keyword: string; slot?: number; found?: boolean }[]; window: WindowState }>(
        ClientCommands.MODULE_ACTION,
        { id, module: "window", action: "explore", args: { item, clickPath } },
      ),
    menuCandidates: (id: string) =>
      emitAck<{ slot: number; id: string; name: string; count: number }[]>(ClientCommands.MODULE_ACTION, {
        id,
        module: "window",
        action: "menuCandidates",
      }),
  },
  js: {
    list: (id: string) =>
      emitAck<{ name: string; pinned: boolean; updatedAt: number | null }[]>(ClientCommands.MODULE_ACTION, {
        id,
        module: "js",
        action: "list",
      }),
    get: (id: string, name: string) =>
      emitAck<{ name: string; code: string } | null>(ClientCommands.MODULE_ACTION, {
        id,
        module: "js",
        action: "get",
        args: { name },
      }),
    save: (id: string, name: string, code: string) =>
      emitAck(ClientCommands.MODULE_ACTION, { id, module: "js", action: "save", args: { name, code } }),
    del: (id: string, name: string) =>
      emitAck(ClientCommands.MODULE_ACTION, { id, module: "js", action: "delete", args: { name } }),
    run: (id: string, name: string, code?: string) =>
      emitAck(ClientCommands.MODULE_ACTION, { id, module: "js", action: "run", args: { name, code } }),
    stop: (id: string) => emitAck(ClientCommands.MODULE_ACTION, { id, module: "js", action: "stop" }),
    pin: (id: string, name: string, pinned: boolean) =>
      emitAck(ClientCommands.MODULE_ACTION, { id, module: "js", action: "pin", args: { name, pinned } }),
  },
  viewer: {
    start: (id: string, firstPerson = false) =>
      emitAck<{ port: number; reused?: boolean; firstPerson?: boolean }>(ClientCommands.MODULE_ACTION, {
        id,
        module: "viewer",
        action: "start",
        args: { firstPerson },
      }),
    stop: (id: string) =>
      emitAck(ClientCommands.MODULE_ACTION, { id, module: "viewer", action: "stop" }),
    clickWalk: (id: string, enabled: boolean) =>
      emitAck(ClientCommands.MODULE_ACTION, {
        id,
        module: "viewer",
        action: "clickWalk",
        args: { enabled },
      }),
  },
  control: {
    set: (id: string, states: Partial<Record<"forward" | "back" | "left" | "right" | "jump" | "sprint" | "sneak", boolean>>) =>
      emitAck(ClientCommands.MODULE_ACTION, { id, module: "move", action: "control", args: states }),
    turn: (id: string, dyaw: number, dpitch = 0) =>
      emitAck(ClientCommands.MODULE_ACTION, { id, module: "move", action: "turn", args: { dyaw, dpitch } }),
    stop: (id: string) => emitAck(ClientCommands.MODULE_ACTION, { id, module: "move", action: "stop" }),
    // 模拟按键的一次性动作：攻击/使用/换手/丢弃/选快捷栏
    tap: (id: string, action: "attack" | "use" | "swap" | "drop" | "slot", slot?: number) =>
      emitAck(ClientCommands.MODULE_ACTION, { id, module: "move", action: "tap", args: { action, slot } }),
  },
  behavior: {
    get: (id: string) =>
      emitAck<{ allowDig: boolean; respawnCommand: string; returnOnDeath: boolean }>(ClientCommands.MODULE_ACTION, {
        id,
        module: "behavior",
        action: "get",
      }),
    setDig: (id: string, allow: boolean) =>
      emitAck<{ allowDig: boolean }>(ClientCommands.MODULE_ACTION, {
        id,
        module: "behavior",
        action: "setDig",
        args: { allow },
      }),
    setRespawnCmd: (id: string, command: string) =>
      emitAck<{ respawnCommand: string }>(ClientCommands.MODULE_ACTION, {
        id,
        module: "behavior",
        action: "setRespawnCmd",
        args: { command },
      }),
    setReturnOnDeath: (id: string, on: boolean) =>
      emitAck<{ returnOnDeath: boolean }>(ClientCommands.MODULE_ACTION, {
        id,
        module: "behavior",
        action: "setReturnOnDeath",
        args: { on },
      }),
  },
  monitor: {
    get: (id: string) =>
      emitAck<{ rules: MonitorRule[]; stats: Record<string, MonitorStat> }>(ClientCommands.MODULE_ACTION, {
        id,
        module: "monitor",
        action: "get",
      }),
    setRules: (id: string, rules: MonitorRule[]) =>
      emitAck<{ rules: MonitorRule[]; stats: Record<string, MonitorStat> }>(ClientCommands.MODULE_ACTION, {
        id,
        module: "monitor",
        action: "setRules",
        args: { rules },
      }),
    reset: (id: string) =>
      emitAck(ClientCommands.MODULE_ACTION, { id, module: "monitor", action: "reset" }),
    test: (id: string, pattern: string, valueGroup: number, numberMode: boolean, sample: string) =>
      emitAck<{ ok: boolean; matched?: boolean; group?: string | null; value?: number | null; error?: string }>(
        ClientCommands.MODULE_ACTION,
        { id, module: "monitor", action: "test", args: { pattern, valueGroup, numberMode, sample } },
      ),
  },
};
