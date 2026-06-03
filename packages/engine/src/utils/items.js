// 物品/装备解析助手：附魔中文名、自定义名、装备摘要。
// 被 player_inventory.js 与 ai/observe.ts 共用，避免重复。

const ENCH_CN = {
  sharpness: "锋利",
  smite: "亡灵杀手",
  bane_of_arthropods: "节肢杀手",
  knockback: "击退",
  fire_aspect: "火焰附加",
  looting: "抢夺",
  sweeping: "横扫之刃",
  efficiency: "效率",
  silk_touch: "精准采集",
  unbreaking: "耐久",
  fortune: "时运",
  power: "力量",
  punch: "冲击",
  flame: "火矢",
  infinity: "无限",
  protection: "保护",
  fire_protection: "火焰保护",
  feather_falling: "摔落保护",
  blast_protection: "爆炸保护",
  projectile_protection: "弹射物保护",
  thorns: "荆棘",
  respiration: "水下呼吸",
  aqua_affinity: "水下速掘",
  depth_strider: "深海探索者",
  frost_walker: "冰霜行者",
  mending: "经验修补",
  curse_of_vanishing: "消失诅咒",
  curse_of_binding: "绑定诅咒",
  luck_of_the_sea: "海之眷顾",
  lure: "饵钓",
};

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const roman = (n) => ROMAN[n] || String(n);

/** 去除 §x 颜色码 */
function cleanName(s) {
  return String(s == null ? "" : s).replace(/§[0-9a-fk-orx]/gi, "");
}

/** 把 mineflayer item.enchants 转成 ["锋利 V", ...] */
function enchantNames(item) {
  try {
    const e = item && item.enchants;
    if (Array.isArray(e) && e.length) {
      return e
        .map((x) => {
          const id = String((x && x.name) || "").replace(/^minecraft:/, "");
          if (!id) return null;
          const cn = ENCH_CN[id] || id;
          const lvl = (x && (x.lvl || x.level)) || 1;
          return lvl > 1 ? `${cn} ${roman(lvl)}` : cn;
        })
        .filter(Boolean);
    }
  } catch {
    /* ignore */
  }
  return [];
}

/** 优先取 NBT 自定义名（RPG 物品），否则原版 displayName */
function customName(item) {
  let name = (item && (item.displayName || item.name)) || "";
  try {
    const d =
      item && item.nbt && item.nbt.value && item.nbt.value.display && item.nbt.value.display.value;
    if (d && d.Name && d.Name.value) name = d.Name.value;
  } catch {
    /* ignore */
  }
  return cleanName(name);
}

/** 装备/手持物的精简摘要 */
function itemBrief(item) {
  if (!item) return null;
  return {
    name: customName(item),
    id: item.name,
    count: item.count,
    enchants: enchantNames(item),
  };
}

module.exports = { ENCH_CN, roman, cleanName, enchantNames, customName, itemBrief };
