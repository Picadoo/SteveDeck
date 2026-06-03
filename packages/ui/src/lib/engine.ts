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
  socket.on(ServerEvents.INVENTORY, (p: { user: string; items: InventoryItem[] }) => {
    if (p.user) useStore.getState().setInventory(p.user, p.items || []);
  });
  socket.on(ServerEvents.WINDOW_OPEN, (p: { user: string; window: WindowState }) => {
    if (p.user) useStore.getState().setWindow(p.user, p.window);
  });
  socket.on(ServerEvents.WINDOW_CLOSE, (p: { user: string }) => {
    if (p.user) useStore.getState().setWindow(p.user, null);
  });
}

export function disconnect(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  useStore.getState().setConn({ status: "disconnected" });
}

function emitAck<T = unknown>(event: string, payload: unknown): Promise<CommandAck<T>> {
  return new Promise((resolve) => {
    if (!socket || !socket.connected) {
      resolve({ ok: false, error: "未连接到引擎" });
      return;
    }
    socket
      .timeout(8000)
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
      loginPassword?: string;
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
      emitAck<WindowState | null>(ClientCommands.MODULE_ACTION, {
        id,
        module: "window",
        action: "openAt",
        args: { x, y, z },
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
  },
  control: {
    set: (id: string, states: Partial<Record<"forward" | "back" | "left" | "right" | "jump" | "sprint" | "sneak", boolean>>) =>
      emitAck(ClientCommands.MODULE_ACTION, { id, module: "move", action: "control", args: states }),
    turn: (id: string, dyaw: number, dpitch = 0) =>
      emitAck(ClientCommands.MODULE_ACTION, { id, module: "move", action: "turn", args: { dyaw, dpitch } }),
    stop: (id: string) => emitAck(ClientCommands.MODULE_ACTION, { id, module: "move", action: "stop" }),
  },
  behavior: {
    get: (id: string) =>
      emitAck<{ allowDig: boolean; respawnCommand: string }>(ClientCommands.MODULE_ACTION, {
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
  },
};
