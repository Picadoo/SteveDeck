import { create } from "zustand";
import type { BotStatus, BotSummary, LogLine, InventoryItem, WindowState } from "@mcbot/protocol";

export type ConnStatus = "disconnected" | "connecting" | "online" | "error";

export interface ConnState {
  status: ConnStatus;
  url: string;
  token: string;
  error?: string;
  engine?: { version: string; protocolVersion: number };
}

export type ToastTone = "error" | "success" | "info";
export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}
let toastSeq = 0;

const MAX_LOG_LINES = 500;

interface AppState {
  theme: "light" | "dark";
  conn: ConnState;
  bots: BotSummary[];
  logs: Record<string, LogLine[]>;
  selectedId: string | null;
  /** 模块配置缓存，键为 `${botId}:${module}`，跨开关保留用户填写的参数 */
  moduleConfigs: Record<string, Record<string, unknown>>;
  /** 背包数据，按机器人用户名键 */
  inventory: Record<string, InventoryItem[]>;
  /** 当前打开的窗口/GUI，按机器人用户名键（null 表示无） */
  windows: Record<string, WindowState | null>;
  /** 最近发送的聊天/命令（全局，持久化，去重） */
  chatHistory: string[];
  toasts: Toast[];

  setTheme: (t: "light" | "dark") => void;
  setModuleConfig: (botId: string, module: string, config: Record<string, unknown>) => void;
  setInventory: (user: string, items: InventoryItem[]) => void;
  setWindow: (user: string, win: WindowState | null) => void;
  pushCmd: (c: string) => void;
  pushToast: (message: string, tone?: ToastTone) => void;
  dismissToast: (id: number) => void;
  toggleTheme: () => void;
  setConn: (partial: Partial<ConnState>) => void;
  setBots: (bots: BotSummary[]) => void;
  upsertBot: (bot: BotStatus) => void;
  removeBot: (id: string) => void;
  appendLog: (id: string, line: LogLine) => void;
  clearLog: (id: string) => void;
  setSelected: (id: string | null) => void;
}

function applyTheme(theme: "light" | "dark") {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem("mcbot.theme", theme);
  } catch {
    /* ignore */
  }
}

function initialTheme(): "light" | "dark" {
  try {
    const saved = localStorage.getItem("mcbot.theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore */
  }
  return "dark";
}

const CMD_KEY = "mcbot.cmdhistory";
function loadCmdHistory(): string[] {
  try {
    const raw = localStorage.getItem(CMD_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return [];
}

export const useStore = create<AppState>((set, get) => ({
  theme: initialTheme(),
  conn: { status: "disconnected", url: "", token: "" },
  bots: [],
  logs: {},
  selectedId: null,
  moduleConfigs: {},
  inventory: {},
  windows: {},
  chatHistory: loadCmdHistory(),
  toasts: [],

  pushToast: (message, tone = "info") => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    setTimeout(() => get().dismissToast(id), 4000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setModuleConfig: (botId, module, config) =>
    set((s) => ({
      moduleConfigs: { ...s.moduleConfigs, [`${botId}:${module}`]: config },
    })),
  setInventory: (user, items) =>
    set((s) => ({ inventory: { ...s.inventory, [user]: items } })),
  setWindow: (user, win) => set((s) => ({ windows: { ...s.windows, [user]: win } })),
  pushCmd: (c) =>
    set((s) => {
      const cmd = c.trim();
      if (!cmd) return {};
      const next = [cmd, ...s.chatHistory.filter((x) => x !== cmd)].slice(0, 30);
      try {
        localStorage.setItem(CMD_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return { chatHistory: next };
    }),
  setTheme: (t) => {
    applyTheme(t);
    set({ theme: t });
  },
  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    applyTheme(next);
    set({ theme: next });
  },
  setConn: (partial) => set((s) => ({ conn: { ...s.conn, ...partial } })),
  setBots: (bots) =>
    set((s) => {
      const ids = new Set(bots.map((b) => b.id));
      let selectedId = s.selectedId;
      if (!selectedId && bots.length) selectedId = bots[0].id;
      if (selectedId && !ids.has(selectedId)) selectedId = bots[0]?.id ?? null;
      return { bots, selectedId };
    }),
  upsertBot: (bot) =>
    set((s) => {
      const idx = s.bots.findIndex((b) => b.id === bot.id);
      if (idx === -1) return { bots: [...s.bots, bot] };
      const next = s.bots.slice();
      next[idx] = { ...next[idx], ...bot };
      return { bots: next };
    }),
  removeBot: (id) =>
    set((s) => {
      const bots = s.bots.filter((b) => b.id !== id);
      const logs = { ...s.logs };
      delete logs[id];
      const selectedId = s.selectedId === id ? (bots[0]?.id ?? null) : s.selectedId;
      return { bots, logs, selectedId };
    }),
  appendLog: (id, line) =>
    set((s) => {
      const prev = s.logs[id] ?? [];
      const next = prev.length >= MAX_LOG_LINES ? [...prev.slice(prev.length - MAX_LOG_LINES + 1), line] : [...prev, line];
      return { logs: { ...s.logs, [id]: next } };
    }),
  clearLog: (id) => set((s) => ({ logs: { ...s.logs, [id]: [] } })),
  setSelected: (id) => set({ selectedId: id }),
}));
