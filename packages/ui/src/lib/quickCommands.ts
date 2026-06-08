// 快捷指令：点按钮 → 给机器人发一条指令。
// 通用可配置——不写死任何服务器的菜单；用户自己填「名字 + 指令」。
// 按服务器 host 存 localStorage（与 headerMetrics 同一套路）。
//
// 注意：此处不提供「快捷键」。原因：① 安卓端浏览器收不到按键；
// ② Z/R/X 这类键对应的是 DragonCore 等客户端菜单，无头 bot 根本按不出来，
// 只有对应的斜杠指令才有意义。所以一律「点按钮发指令」。

export interface QuickCmd {
  id: string;
  name: string; // 显示名（如「官方杀戮」）；留空则用指令本身当显示
  command: string; // 要发送的指令（如 /kill、/menu）
}

const LS = (host: string) => `mcbot.quickCmds.${host}`;

let _seq = 0;
export function newQuickCmdId(): string {
  return `qc_${Date.now().toString(36)}_${(_seq++).toString(36)}`;
}

export function loadQuickCmds(host: string): QuickCmd[] {
  try {
    const r = localStorage.getItem(LS(host));
    if (r) {
      const a = JSON.parse(r);
      if (Array.isArray(a)) {
        // 向后兼容：旧数据里可能带 key 字段，这里直接忽略（不再有「快捷键」概念）。
        return a
          .filter((x) => x && typeof x.command === "string")
          .map((x) => ({
            id: typeof x.id === "string" ? x.id : newQuickCmdId(),
            name: typeof x.name === "string" ? x.name : "",
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
