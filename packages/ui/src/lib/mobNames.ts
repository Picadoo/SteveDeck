// 常见生物英文名 → 中文（无自定义名牌时的友好回退）。交互页 / 概览页共用。
export const MOB_CN: Record<string, string> = {
  zombie: "僵尸",
  skeleton: "骷髅",
  creeper: "苦力怕",
  spider: "蜘蛛",
  cave_spider: "洞穴蜘蛛",
  enderman: "末影人",
  witch: "女巫",
  slime: "史莱姆",
  cow: "牛",
  pig: "猪",
  sheep: "羊",
  chicken: "鸡",
  villager: "村民",
  squid: "鱿鱼",
  bat: "蝙蝠",
  horse: "马",
  wolf: "狼",
  zombie_villager: "僵尸村民",
  husk: "尸壳",
  stray: "流浪者",
  drowned: "溺尸",
  blaze: "烈焰人",
  ghast: "恶魂",
  magma_cube: "岩浆怪",
  wither_skeleton: "凋灵骷髅",
  phantom: "幻翼",
  rabbit: "兔子",
  iron_golem: "铁傀儡",
  snowman: "雪傀儡",
  ocelot: "豹猫",
  cat: "猫",
  mooshroom: "哞菇",
  polar_bear: "北极熊",
  llama: "羊驼",
  parrot: "鹦鹉",
  donkey: "驴",
  mule: "骡",
  skeleton_horse: "骷髅马",
  zombie_horse: "僵尸马",
  guardian: "守卫者",
  elder_guardian: "远古守卫者",
  shulker: "潜影贝",
  vindicator: "卫道士",
  evoker: "唤魔者",
  illusioner: "幻术师",
  vex: "恼鬼",
  silverfish: "蠹虫",
  endermite: "末影螨",
  zombie_pigman: "僵尸猪人",
  wither: "凋灵",
  ender_dragon: "末影龙",
  giant: "巨人",
  armor_stand: "盔甲架",
};

/** 归一化实体名：小写 + 空格转下划线（displayName 形如 "Zombie Villager" 也能命中 zombie_villager） */
export const normMob = (s?: string | null): string =>
  String(s || "").toLowerCase().replace(/ /g, "_");

/** 取生物中文名；无映射则返回原名 */
export function cnMob(name?: string | null): string {
  if (!name) return "";
  return MOB_CN[normMob(name)] || name;
}
