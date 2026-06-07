// 快捷指令：按某个键 / 点按钮 → 给机器人发一条指令。
// 通用可配置——不写死任何服务器的菜单；用户自己填「名字 + 触发键 + 指令」。
// 按服务器 host 存 localStorage（与 headerMetrics 同一套路）。

export interface QuickCmd {
  id: string;
  name: string; // 显示名（如「官方杀戮」）
  key: string; // 触发键：单个字符，大小写不敏感；留空 = 仅点按钮、不绑键
  command: string; // 要发送的指令（如 /kill、/menu）
}

const LS = (host: string) => `mcbot.quickCmds.${host}`;

let _seq = 0;
export function newQuickCmdId(): string {
  return `qc_${Date.now().toString(36)}_${(_seq++).toString(36)}`;
}

/** 触发键只接受单个字符（多字符/空 → 视为不绑键）。 */
export function sanitizeKey(k: unknown): string {
  if (typeof k !== "string") return "";
  const c = k.trim();
  return c.length === 1 ? c : "";
}

export function loadQuickCmds(host: string): QuickCmd[] {
  try {
    const r = localStorage.getItem(LS(host));
    if (r) {
      const a = JSON.parse(r);
      if (Array.isArray(a)) {
        return a
          .filter((x) => x && typeof x.command === "string")
          .map((x) => ({
            id: typeof x.id === "string" ? x.id : newQuickCmdId(),
            name: typeof x.name === "string" ? x.name : "",
            key: sanitizeKey(x.key),
            command: String(x.command),
          }));
      }
    }
  } catch {
    /* 解析失败 → 忽略 */
  }
  return [];
}

export function saveQuickCmds(host: string, list: QuickCmd[]): void {
  try {
    localStorage.setItem(LS(host), JSON.stringify(list));
  } catch {
    /* localStorage 满/禁用 → 忽略 */
  }
}

// 可一键载入的「示例骨架」：用户列出的 mcly 快捷项。
// 只预填名字+键，指令故意留空（不猜服务器指令以免误导）——载入后由用户补上各自的指令。
export const MCLY_TEMPLATE: { name: string; key: string }[] = [
  { name: "快捷菜单", key: "Z" },
  { name: "官方杀戮", key: "R" },
  { name: "符文镶嵌", key: "X" },
  { name: "宝石镶嵌", key: "B" },
  { name: "玩家信息", key: "O" },
  { name: "每日奖励", key: "M" },
  { name: "RMB商城", key: "G" },
  { name: "常用功能", key: "Y" },
];
