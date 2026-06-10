import type { BotSummary } from "@mcbot/protocol";

/** 生命百分比（基于最大生命，RPG 服可能 >20）。离线返回 null。 */
export function healthPct(bot: Pick<BotSummary, "health" | "maxHealth">): number | null {
  if (bot.health == null) return null;
  const max = bot.maxHealth && bot.maxHealth > 0 ? bot.maxHealth : 20;
  return Math.max(0, Math.min(100, Math.round((bot.health / max) * 100)));
}

/** 百分比对应的文字色调 */
export function healthTone(pct: number | null): string {
  if (pct == null) return "text-muted";
  if (pct > 60) return "text-success";
  if (pct > 30) return "text-warning";
  return "text-danger";
}

/** 百分比对应的进度条背景色 */
export function healthBar(pct: number | null): string {
  if (pct == null) return "bg-muted/40";
  if (pct > 60) return "bg-success";
  if (pct > 30) return "bg-warning";
  return "bg-danger";
}

/** 大数 → 中文单位（1500000→150万 · 1.62e10→162亿 · 1.2e12→1.2万亿）。小于 1万原样显示。 */
export function fmtBig(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const unit = (v: number, u: string) => {
    const s = v >= 100 ? Math.round(v).toString() : v.toFixed(v >= 10 ? 1 : 2).replace(/\.?0+$/, "");
    return sign + s + u;
  };
  if (abs < 1e4) return sign + Math.round(abs).toString();
  if (abs < 1e8) return unit(abs / 1e4, "万");
  if (abs < 1e12) return unit(abs / 1e8, "亿");
  return unit(abs / 1e12, "万亿");
}

/**
 * 去掉 Minecraft 颜色/格式码（§ 与 & 系），得到屏幕上看到的纯文本。
 * 用于搜索/过滤/复制——避免拿带 §c/§f 的原文匹配，导致"按看到的字过滤却匹配不上"。
 * 同时对 null/undefined 安全（返回 ""），防止过滤时 .toLowerCase() 抛错。
 */
export function mcPlain(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/[§&]#[0-9a-fA-F]{6}/g, "") // §#RRGGBB / &#RRGGBB
    .replace(/[§&]x(?:[§&][0-9a-fA-F]){6}/gi, "") // §x§R§R§G§G§B§B
    .replace(/§./g, "") // § 后任意字符都是格式码（含 §u/§j 等服务器自造码）
    .replace(/&[0-9a-fk-or]/gi, ""); // & 只认标准码——它是聊天里会真实出现的普通字符
}

/** 秒 → 在线时长（如 2天3时 / 5时12分 / 8分30秒） */
export function fmtUptime(sec: number | null | undefined): string {
  if (sec == null || sec < 0) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (d > 0) return `${d}天${h}时`;
  if (h > 0) return `${h}时${m}分`;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}
