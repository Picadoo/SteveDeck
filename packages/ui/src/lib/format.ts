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
