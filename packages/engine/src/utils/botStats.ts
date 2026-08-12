// bot 属性读取小工具（此前 botManager 与 ai/observe 各拷一份逐字相同的实现）。

/** 读取最大生命属性（RPG 服常把它调高到 >20）。取不到则回退 20。 */
export function maxHealthOf(bot: any): number {
  try {
    const a = bot?.entity?.attributes;
    if (a) {
      const e =
        a["minecraft:generic.max_health"] || a["generic.maxHealth"] || a["generic.max_health"];
      const v = e?.value;
      if (typeof v === "number" && v > 0) return Math.round(v);
    }
  } catch {
    /* ignore */
  }
  return 20;
}
