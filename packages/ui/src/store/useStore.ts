import { create } from "zustand";
import type { BotStatus, BotSummary, LogLine, InventoryItem, WindowState, MonitorStat } from "@mcbot/protocol";

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
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

const MAX_LOG_LINES = 500;
// 日志渲染序号：单调递增，给 React 当稳定 key。满 500 条后 appendLog 是滑动窗口，
// 基于内容/下标的 key 会整窗左移 → 500 行 unmount+remount（低端机 30-80ms/条）。
let logSeq = 0;

/** 脚本运行时反馈（来自引擎 script_status/progress/error/vars），按机器人 id 键 */
export interface ScriptRuntime {
  name?: string;
  status?: string; // running / stopped / rejected
  detail?: string;
  path?: string;
  action?: string;
  loopIter?: number;
  error?: { path?: string; action?: string; message: string; time: string } | null;
  vars?: Record<string, unknown>;
}

interface AppState {
  theme: "light" | "dark";
  /** 背包显示模式：lite 精简（纯文本）/ full 完全（贴图+彩色名+描述） */
  invMode: "lite" | "full";
  /** 可点击聊天：开=渲染 clickEvent/hoverEvent 为可点按钮+悬浮；关=当普通文本（防误点跑指令） */
  clickableChat: boolean;
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
  /** 脚本运行时反馈，按机器人 id 键 */
  scriptRuntime: Record<string, ScriptRuntime>;
  /** 消息监听统计，按机器人 id 键 → ruleId → 统计 */
  monitorStats: Record<string, Record<string, MonitorStat>>;
  /** 最近发送的聊天/命令（全局，持久化，去重） */
  chatHistory: string[];
  toasts: Toast[];

  setTheme: (t: "light" | "dark") => void;
  setInvMode: (m: "lite" | "full") => void;
  setClickableChat: (v: boolean) => void;
  setModuleConfig: (botId: string, module: string, config: Record<string, unknown>) => void;
  setInventory: (user: string, items: InventoryItem[]) => void;
  setWindow: (user: string, win: WindowState | null) => void;
  mergeScriptRuntime: (id: string, patch: Partial<ScriptRuntime>) => void;
  setMonitorStats: (id: string, stats: Record<string, MonitorStat>) => void;
  pushCmd: (c: string) => void;
  pushToast: (message: string, tone?: ToastTone) => void;
  dismissToast: (id: number) => void;
  pauseToast: (id: number) => void;
  resumeToast: (id: number) => void;
  toggleTheme: () => void;
  setConn: (partial: Partial<ConnState>) => void;
  setBots: (bots: BotSummary[]) => void;
  upsertBot: (bot: BotStatus) => void;
  removeBot: (id: string) => void;
  /** 清空所有 per-bot 映射与选中项（切换引擎/断开时调用，防陈旧数据串引擎） */
  resetSession: () => void;
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

function initialInvMode(): "lite" | "full" {
  try {
    const saved = localStorage.getItem("mcbot.invmode");
    if (saved === "lite" || saved === "full") return saved;
  } catch {
    /* ignore */
  }
  return "full";
}

function initialClickableChat(): boolean {
  try {
    return localStorage.getItem("mcbot.clickchat") !== "0"; // 默认开启
  } catch {
    return true;
  }
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
  invMode: initialInvMode(),
  clickableChat: initialClickableChat(),
  conn: { status: "disconnected", url: "", token: "" },
  bots: [],
  logs: {},
  selectedId: null,
  moduleConfigs: {},
  inventory: {},
  windows: {},
  scriptRuntime: {},
  monitorStats: {},
  chatHistory: loadCmdHistory(),
  toasts: [],

  pushToast: (message, tone = "info") => {
    const existing = get().toasts;
    if (existing.some((t) => t.message === message && t.tone === (tone ?? "info"))) return;
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    const timer = setTimeout(() => get().dismissToast(id), 4000);
    toastTimers.set(id, timer);
  },
  dismissToast: (id) => {
    const timer = toastTimers.get(id);
    if (timer) { clearTimeout(timer); toastTimers.delete(id); }
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
  pauseToast: (id) => {
    const timer = toastTimers.get(id);
    if (timer) { clearTimeout(timer); toastTimers.delete(id); }
  },
  resumeToast: (id) => {
    if (!get().toasts.some((t) => t.id === id)) return;
    const timer = setTimeout(() => get().dismissToast(id), 2000);
    toastTimers.set(id, timer);
  },

  setModuleConfig: (botId, module, config) =>
    set((s) => ({
      moduleConfigs: { ...s.moduleConfigs, [`${botId}:${module}`]: config },
    })),
  setInventory: (user, items) =>
    set((s) => ({ inventory: { ...s.inventory, [user]: items } })),
  setWindow: (user, win) => set((s) => ({ windows: { ...s.windows, [user]: win } })),
  mergeScriptRuntime: (id, patch) =>
    set((s) => ({ scriptRuntime: { ...s.scriptRuntime, [id]: { ...s.scriptRuntime[id], ...patch } } })),
  setMonitorStats: (id, stats) =>
    set((s) => ({ monitorStats: { ...s.monitorStats, [id]: stats } })),
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
  setInvMode: (m) => {
    try {
      localStorage.setItem("mcbot.invmode", m);
    } catch {
      /* ignore */
    }
    set({ invMode: m });
  },
  setClickableChat: (v) => {
    try {
      localStorage.setItem("mcbot.clickchat", v ? "1" : "0");
    } catch {
      /* ignore */
    }
    set({ clickableChat: v });
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
      // 无变化短路：引擎 30s 保活推送内容常与上次相同；不换引用就不触发
      // 订阅 bots/单 bot 的整棵组件树（BotPanel/Sidebar 行/QuickCommands）重渲。
      // 浅比较只看顶层标量+savedLocations/modules 的 JSON（小对象，微秒级）。
      const prev = s.bots[idx] as unknown as Record<string, unknown>;
      const incoming = bot as unknown as Record<string, unknown>;
      let changed = false;
      for (const k of Object.keys(incoming)) {
        const a = prev[k];
        const v = incoming[k];
        if (a === v) continue;
        if (typeof v === "object" && v !== null && JSON.stringify(a) === JSON.stringify(v)) continue;
        changed = true;
        break;
      }
      if (!changed) return {};
      const next = s.bots.slice();
      next[idx] = { ...next[idx], ...bot };
      return { bots: next };
    }),
  removeBot: (id) =>
    set((s) => {
      const removed = s.bots.find((b) => b.id === id);
      const bots = s.bots.filter((b) => b.id !== id);
      // UICORE-1：回收该 bot 的全部 per-bot 映射，避免删/重建累积永不可达的陈旧条目
      const logs = { ...s.logs };
      delete logs[id];
      const scriptRuntime = { ...s.scriptRuntime };
      delete scriptRuntime[id];
      const monitorStats = { ...s.monitorStats };
      delete monitorStats[id];
      // inventory/windows 键为 _bid||username（见 engine.ts），两种键形都清
      const inventory = { ...s.inventory };
      const windows = { ...s.windows };
      delete inventory[id];
      delete windows[id];
      if (removed?.username) {
        delete inventory[removed.username];
        delete windows[removed.username];
      }
      // moduleConfigs 键为 `${id}:${module}`，删该 id 的所有模块项
      const moduleConfigs = { ...s.moduleConfigs };
      for (const k of Object.keys(moduleConfigs)) {
        if (k.startsWith(`${id}:`)) delete moduleConfigs[k];
      }
      const selectedId = s.selectedId === id ? (bots[0]?.id ?? null) : s.selectedId;
      return { bots, logs, scriptRuntime, monitorStats, inventory, windows, moduleConfigs, selectedId };
    }),
  resetSession: () =>
    set({
      logs: {},
      inventory: {},
      windows: {},
      scriptRuntime: {},
      monitorStats: {},
      moduleConfigs: {},
      selectedId: null,
    }),
  appendLog: (id, line) =>
    set((s) => {
      line.seq = ++logSeq;
      const prev = s.logs[id] ?? [];
      const next = prev.length >= MAX_LOG_LINES ? [...prev.slice(prev.length - MAX_LOG_LINES + 1), line] : [...prev, line];
      return { logs: { ...s.logs, [id]: next } };
    }),
  clearLog: (id) => set((s) => ({ logs: { ...s.logs, [id]: [] } })),
  setSelected: (id) => set({ selectedId: id }),
}));
