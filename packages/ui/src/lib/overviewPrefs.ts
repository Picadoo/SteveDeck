// 概览页偏好：哪些卡片显示 + 实时刷新间隔。全局持久化（localStorage）。
export type OverviewPrefs = { hidden: Record<string, boolean>; intervalSec: number };

const KEY = "mcbot.overview";
const DEFAULT_INTERVAL = 3.5;

// 卡片清单（顺序与 OverviewTab 渲染一致）；key 用于开关与持久化
export const OVERVIEW_CARDS: { key: string; label: string }[] = [
  { key: "activity", label: "当前活动" },
  { key: "feed", label: "最近动态" },
  { key: "stats", label: "状态磁贴" },
  { key: "pos", label: "坐标" },
  { key: "nearby", label: "附近" },
  { key: "boss", label: "Boss 血条" },
  { key: "tablist", label: "Tab 列表" },
  { key: "scoreboard", label: "计分板" },
];

export function loadOverviewPrefs(): OverviewPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw);
      return {
        hidden: o && typeof o.hidden === "object" ? o.hidden : {},
        intervalSec: typeof o?.intervalSec === "number" && o.intervalSec > 0 ? o.intervalSec : DEFAULT_INTERVAL,
      };
    }
  } catch {
    /* ignore */
  }
  return { hidden: {}, intervalSec: DEFAULT_INTERVAL };
}

export function saveOverviewPrefs(p: OverviewPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
