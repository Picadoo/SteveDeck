// 物品贴图组件（背包 / GUI 窗口共用）：按 1.12.2 贴图命名尝试多个候选路径，全失败回退图标。
import { useEffect, useState } from "react";
import { Package } from "lucide-react";

// 物品 id → 贴图文件名的常见别名（1.12.2 旧命名与 id 不一致处）
export const TEX_ALIAS: Record<string, string> = {
  golden_apple: "apple_golden",
  golden_carrot: "carrot_golden",
  cooked_beef: "beef_cooked",
  cooked_porkchop: "porkchop_cooked",
  cooked_chicken: "chicken_cooked",
  cooked_mutton: "mutton_cooked",
  cooked_rabbit: "rabbit_cooked",
  cooked_fish: "fish_cod_cooked",
  cooked_salmon: "fish_salmon_cooked",
  redstone: "redstone_dust",
  bow: "bow_standby",
  clock: "clock_00",
  watch: "clock_00",
  slime_ball: "slimeball",
  tripwire_hook: "trip_wire_source",
  fishing_rod: "fishing_rod_uncast",
  carrot_on_a_stick: "carrot_on_a_stick",
  filled_map: "map_filled",
  map: "map_empty",
  potion: "potion_bottle_drinkable",
  lead: "lead",
};

/** 物品贴图：依次尝试 items/<id> → blocks/<id> → 别名，全失败回退到图标 */
export function ItemIcon({ texture, base, size }: { texture?: string; base: string; size: number }) {
  const [stage, setStage] = useState(0);
  useEffect(() => setStage(0), [texture]);

  const id = (texture || "").toLowerCase();
  const alias = TEX_ALIAS[id];
  const candidates = [
    `${base}/items/${id}.png`,
    `${base}/blocks/${id}.png`,
    alias ? `${base}/items/${alias}.png` : null,
    alias ? `${base}/blocks/${alias}.png` : null,
  ].filter(Boolean) as string[];

  const box = { width: size, height: size };
  if (!id || stage >= candidates.length) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded bg-surface-2 text-muted"
        style={box}
      >
        <Package className="h-4 w-4 opacity-50" />
      </div>
    );
  }
  return (
    <img
      src={candidates[stage]}
      alt=""
      draggable={false}
      style={{ ...box, imageRendering: "pixelated" }}
      className="shrink-0 rounded bg-surface-2/60"
      onError={() => setStage((s) => s + 1)}
    />
  );
}
