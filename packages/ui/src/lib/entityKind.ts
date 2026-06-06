// 附近实体分类：玩家 / NPC / 村民 / 怪物 / 动物 / 其它。
// 单一来源，概览页与现场页共用，命名清清楚楚——不再有「命名」这种看不懂的标签。
import { normMob } from "./mobNames";

export type NearbyKind = "player" | "npc" | "villager" | "hostile" | "animal" | "other";

// 敌对生物 id（引擎 hostile 标记缺失时兜底）
export const HOSTILE_IDS = new Set([
  "zombie", "husk", "drowned", "zombie_villager", "skeleton", "stray", "wither_skeleton",
  "creeper", "spider", "cave_spider", "enderman", "endermite", "silverfish", "witch", "slime",
  "magma_cube", "blaze", "ghast", "guardian", "elder_guardian", "shulker", "vex", "vindicator",
  "evoker", "illusioner", "ravager", "pillager", "phantom", "zombified_piglin", "zombie_pigman",
  "piglin", "hoglin", "zoglin", "wither", "ender_dragon", "giant", "warden",
]);

// 村民类（可交易/任务 NPC 底座常用这些；按「形态」归村民，符合直觉）
const VILLAGER_IDS = new Set(["villager", "wandering_trader"]);

// 被动/中立动物、水生、宠物
const ANIMAL_IDS = new Set([
  "cow", "mooshroom", "pig", "sheep", "chicken", "rabbit", "horse", "donkey", "mule",
  "llama", "trader_llama", "cat", "ocelot", "wolf", "parrot", "fox", "panda", "turtle",
  "dolphin", "bee", "goat", "axolotl", "frog", "tadpole", "strider", "camel", "sniffer",
  "armadillo", "bat", "squid", "glow_squid", "cod", "salmon", "pufferfish", "tropical_fish",
  "polar_bear", "skeleton_horse", "zombie_horse", "snowman", "snow_golem", "iron_golem", "allay",
]);

/** 把一个附近对象归类。玩家走 isPlayer/realPlayer；其余按原始 id 判定。 */
export function classifyNearby(e: {
  isPlayer?: boolean;
  realPlayer?: boolean;
  id?: string | null;
  name?: string | null;
  hostile?: boolean;
}): NearbyKind {
  if (e.isPlayer) return e.realPlayer ? "player" : "npc";
  const id = normMob(e.id || e.name);
  if (e.hostile || HOSTILE_IDS.has(id)) return "hostile";
  if (VILLAGER_IDS.has(id)) return "villager";
  if (ANIMAL_IDS.has(id)) return "animal";
  return "other";
}

export const KIND_ORDER: NearbyKind[] = ["player", "npc", "villager", "hostile", "animal", "other"];

export const KIND_LABEL: Record<NearbyKind, string> = {
  player: "玩家",
  npc: "NPC",
  villager: "村民",
  hostile: "怪物",
  animal: "动物",
  other: "其它",
};

// 分类配色（图标/小标题用）
export const KIND_COLOR: Record<NearbyKind, string> = {
  player: "text-emerald-500",
  npc: "text-sky-400",
  villager: "text-amber-500",
  hostile: "text-danger",
  animal: "text-lime-500",
  other: "text-muted/60",
};
