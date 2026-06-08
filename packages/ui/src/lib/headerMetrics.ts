// 可配置顶栏指标：内置(生命/饱食/等级/延迟/坐标) + 从计分板自动提取的自定义数字(金币/点卷/战力…)。
// 纯函数 + 类型；按服务器 host 存 localStorage。渲染在 BotPanel/HeaderMetricsConfig 里。
import type { ComponentType } from "react";
import { Heart, Drumstick, Star, Wifi, MapPin, Hash } from "lucide-react";
import { healthPct, fmtBig, mcPlain } from "./format";
import type { BotSummary } from "@mcbot/protocol";

export type BuiltinId = "health" | "food" | "level" | "ping" | "pos";
type IconCmp = ComponentType<{ className?: string }>;

export interface PinnedMetric {
  labelKey: string; // 稳定标识（计分板行去掉数字后的文字）
  label: string; // 顶栏显示名
}
export interface HeaderCfg {
  builtins: Record<BuiltinId, boolean>;
  pinned: PinnedMetric[];
}
export interface MetricChip {
  key: string;
  label: string;
  value: string;
  icon: IconCmp;
  iconClass: string;
}

export const BUILTINS: { id: BuiltinId; label: string; icon: IconCmp; iconClass: string; get: (b: BotSummary) => string }[] = [
  { id: "health", label: "生命", icon: Heart, iconClass: "text-danger", get: (b) => { const p = healthPct(b); return p != null ? `${p}%` : "-"; } },
  { id: "food", label: "饱食", icon: Drumstick, iconClass: "text-warning", get: (b) => `${b.food ?? "-"}` },
  { id: "level", label: "等级", icon: Star, iconClass: "text-accent", get: (b) => `${b.level ?? "-"}` },
  { id: "ping", label: "延迟", icon: Wifi, iconClass: "text-success", get: (b) => (b.ping != null ? `${b.ping}ms` : "-") },
  { id: "pos", label: "坐标", icon: MapPin, iconClass: "text-success", get: (b) => (b.pos ? `${b.pos.x}, ${b.pos.y}, ${b.pos.z}` : "-") },
];
const BUILTIN_ICON: Record<BuiltinId, IconCmp> = Object.fromEntries(BUILTINS.map((b) => [b.id, b.icon])) as Record<BuiltinId, IconCmp>;

export function defaultCfg(): HeaderCfg {
  return { builtins: { health: true, food: true, level: true, ping: true, pos: true }, pinned: [] };
}

/** 去 §/& 色码 + 压空白（复用 mcPlain），得到屏幕上看到的纯文本。 */
export function cleanLine(raw: string): string {
  return mcPlain(raw).replace(/\s+/g, " ").trim();
}

// 单位换算：只认中文单位（万=1e4 / 亿=1e8 / 兆=万亿=1e12）。
// 不认英文 k/m：会误伤「87 ms」「3 km」这类——中文 RPG 服计分板几乎只用中文单位。
const UNIT: Record<string, number> = { 万亿: 1e12, 兆: 1e12, 亿: 1e8, 万: 1e4 };
const NUM_RE = /(-?\d[\d,，]*(?:\.\d+)?)\s*(万亿|兆|亿|万)?/;

/** 从一行干净文本里抽第一个数字（支持千分位逗号、小数、中/英文单位）。 */
export function extractNumber(clean: string): { value: number; start: number; end: number } | null {
  const m = NUM_RE.exec(clean);
  if (!m) return null;
  const v0 = parseFloat(m[1].replace(/[,，]/g, ""));
  if (!isFinite(v0)) return null;
  const value = m[2] ? v0 * (UNIT[m[2]] ?? 1) : v0;
  return { value, start: m.index, end: m.index + m[0].length };
}

/** 标签键：去掉数字片段后的文字，再清掉首尾的 :：|>- 等分隔符——稳定标识一行（数值变它不变）。 */
export function labelKey(clean: string): string {
  const n = extractNumber(clean);
  const txt = n ? clean.slice(0, n.start) + clean.slice(n.end) : clean;
  return txt.replace(/[:：|>\-\s]+$/, "").replace(/^[\s>|:-]+/, "").trim();
}

// UICORE-6：两行文本相同 → labelKey 相同。给同键的第二、三…行附加行位后缀消歧，
// 保证不同物理行不会塌成一个键（首行保持裸键，向后兼容已存的钉选）。空 labelKey 仍跳过（由调用方处理）。
function disambiguate(base: string, seen: Map<string, number>): string {
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n === 0 ? base : `${base}#${n + 1}`;
}

const LS = (host: string) => `mcbot.headerMetrics.${host}`;
export function loadCfg(host: string): HeaderCfg {
  try {
    const r = localStorage.getItem(LS(host));
    if (r) {
      const c = JSON.parse(r) as Partial<HeaderCfg>;
      return { builtins: { ...defaultCfg().builtins, ...(c.builtins || {}) }, pinned: Array.isArray(c.pinned) ? c.pinned : [] };
    }
  } catch {
    /* ignore */
  }
  return defaultCfg();
}
export function saveCfg(host: string, cfg: HeaderCfg): void {
  try {
    localStorage.setItem(LS(host), JSON.stringify(cfg));
  } catch {
    /* localStorage 满/禁用 → 忽略 */
  }
}

/** 把计分板行解析成「可勾选的候选指标」（含数字的去重行），供配置面板列出。 */
export function detectFromScoreboard(lines: string[]): { labelKey: string; label: string; value: string; clean: string }[] {
  const out: { labelKey: string; label: string; value: string; clean: string }[] = [];
  const seen = new Map<string, number>();
  for (const raw of lines) {
    const clean = cleanLine(raw);
    const n = extractNumber(clean);
    if (!n) continue;
    const base = labelKey(clean);
    if (!base) continue; // 纯数字行 → 空键，跳过
    const key = disambiguate(base, seen); // 同文本多行 → 第2行起加 #n 后缀，不再静默丢弃
    out.push({ labelKey: key, label: base, value: fmtBig(n.value), clean });
  }
  return out;
}

/** 计算最终顶栏指标卡：启用的内置 + 钉住的自定义(按 labelKey 在当前计分板取当前数字)。 */
export function computeMetrics(bot: BotSummary, scoreboardLines: string[], cfg: HeaderCfg): MetricChip[] {
  const chips: MetricChip[] = [];
  for (const b of BUILTINS) {
    if (cfg.builtins[b.id]) chips.push({ key: `b:${b.id}`, label: b.label, value: b.get(bot), icon: b.icon, iconClass: b.iconClass });
  }
  // 与 detectFromScoreboard 用同一套消歧规则，保证钉选时存下的 key（含 #n 后缀）能取回对应物理行的值。
  const byKey = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const raw of scoreboardLines) {
    const clean = cleanLine(raw);
    const n = extractNumber(clean);
    if (!n) continue;
    const base = labelKey(clean);
    if (!base) continue;
    byKey.set(disambiguate(base, seen), n.value);
  }
  for (const p of cfg.pinned) {
    const v = byKey.get(p.labelKey);
    chips.push({ key: `p:${p.labelKey}`, label: p.label, value: v != null ? fmtBig(v) : "—", icon: Hash, iconClass: "text-accent" });
  }
  return chips;
}

export { BUILTIN_ICON };
