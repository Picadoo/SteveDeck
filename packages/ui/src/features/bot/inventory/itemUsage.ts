// 「常用」栏的使用频率记账：纯前端 localStorage，按 bot 维度，不碰原版槽位。
// 身份键用「去色码显示名 + 物品id」——RPG 服同一 id 常有多种自定义名物品，必须按显示名区分。
import { Shirt, Hand, MousePointerClick } from "lucide-react";
import { mcPlain } from "@/lib/format";
import { storage } from "@/lib/safeStorage";

export type UseAction = "equip" | "hold" | "use";

export interface UsageEntry {
  key: string;
  display: string; // 原始展示名（带色码）
  texture?: string;
  count: number;
  lastUsed: number;
  lastAction: UseAction;
}
export type UsageMap = Record<string, UsageEntry>;

export const ACTION_ICON: Record<UseAction, typeof Hand> = {
  equip: Shirt,
  hold: Hand,
  use: MousePointerClick,
};
export const ACTION_LABEL: Record<UseAction, string> = { equip: "穿戴", hold: "持有", use: "使用" };

export function itemKey(it: { display?: string | null; name?: string | null; texture?: string | null }): string {
  return `${mcPlain(it.display || it.name || "")}\0${it.texture || ""}`;
}

const usageLsKey = (botId: string) => `mcbot.itemUsage.${botId}`;

export function loadUsage(botId: string): UsageMap {
  return storage.getJson<UsageMap>(usageLsKey(botId), {});
}
export function saveUsage(botId: string, map: UsageMap): void {
  storage.setJson(usageLsKey(botId), map);
}
