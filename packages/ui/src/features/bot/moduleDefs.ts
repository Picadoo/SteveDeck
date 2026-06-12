import type { LucideIcon } from "lucide-react";
import { Swords, Fish, Pickaxe, Wheat, Crosshair, Trash2, Footprints } from "lucide-react";
import type { ModuleFlags } from "@mcbot/protocol";

export type FieldType = "switch" | "number" | "tags" | "select" | "multiselect";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
  /** 按当前配置决定是否显示（如：黑名单只在「全部怪物」模式下有意义） */
  showIf?: (cfg: Record<string, unknown>) => boolean;
  /** 拼写校验：值应当存在于该注册表（items=物品名 blocks=方块名）；输错即时红字提醒 */
  registry?: "items" | "blocks";
  /** exact=必须精确等于某个名字（默认）；includes=子串能匹配到至少一个名字即可（如垃圾清理） */
  registryMatch?: "exact" | "includes";
}

export interface ModuleDef {
  key: string;
  name: string;
  icon: LucideIcon;
  desc: string;
  activeFlag: keyof ModuleFlags;
  /** toggle: 配置随开关下发；config: 通过 module:config 实时应用（战斗） */
  applyVia: "toggle" | "config";
  fields: FieldDef[];
}

const CROPS = [
  { value: "wheat", label: "小麦" },
  { value: "carrots", label: "胡萝卜" },
  { value: "potatoes", label: "土豆" },
  { value: "beetroots", label: "甜菜根" },
  { value: "pumpkin", label: "南瓜" },
  { value: "melon", label: "西瓜" },
];

export const MODULES: ModuleDef[] = [
  {
    key: "combat",
    name: "自动战斗",
    icon: Swords,
    desc: "自动攻击范围内的目标",
    activeFlag: "combat",
    applyVia: "config",
    fields: [
      { key: "range", label: "攻击距离", type: "number", default: 4.5, min: 1, max: 6, step: 0.5 },
      { key: "maxTargets", label: "最大目标数", type: "number", default: 2, min: 1, max: 10 },
      { key: "attackMobs", label: "攻击怪物", type: "switch", default: true },
      { key: "attackPlayers", label: "攻击玩家 (PVP)", type: "switch", default: false },
      { key: "antiKb", label: "静止防击退", type: "switch", default: true },
    ],
  },
  {
    key: "fishing",
    name: "自动钓鱼",
    icon: Fish,
    desc: "持杆自动抛竿收竿",
    activeFlag: "fishing",
    applyVia: "toggle",
    fields: [],
  },
  {
    key: "automine",
    name: "自动挖矿",
    icon: Pickaxe,
    desc: "搜索并挖取目标矿物",
    activeFlag: "automine",
    applyVia: "toggle",
    fields: [
      {
        key: "targets",
        label: "目标方块（逗号分隔）",
        type: "tags",
        default: ["diamond_ore", "deepslate_diamond_ore"],
        placeholder: "diamond_ore, iron_ore",
        registry: "blocks",
      },
      {
        key: "mode",
        label: "工作模式",
        type: "select",
        default: "mine",
        options: [
          { value: "mine", label: "挖取（采集方块）" },
          { value: "find", label: "寻找（只定位不挖）" },
        ],
      },
      { key: "scanRadius", label: "搜索半径", type: "number", default: 32, min: 4, max: 64 },
      {
        key: "allowPlace",
        label: "允许搭方块脱困",
        type: "switch",
        default: false,
        hint: "背包有圆石/泥土等时可垫脚搭柱——挖到坑底/基岩附近也能自己上来。",
      },
    ],
  },
  {
    key: "auto_farm",
    name: "自动农场",
    icon: Wheat,
    desc: "收割·补种·骨粉催熟",
    activeFlag: "autofarm",
    applyVia: "toggle",
    fields: [
      { key: "cropTypes", label: "作物类型", type: "multiselect", default: ["wheat"], options: CROPS },
      { key: "scanRadius", label: "扫描半径", type: "number", default: 32, min: 16, max: 64 },
      { key: "useBoneMeal", label: "使用骨粉催熟", type: "switch", default: true },
      { key: "autoReplant", label: "自动补种", type: "switch", default: true },
      { key: "sortInventory", label: "自动整理背包", type: "switch", default: true },
    ],
  },
  {
    key: "mob_hunter",
    name: "追怪系统",
    icon: Crosshair,
    desc: "区域内自动猎杀怪物",
    activeFlag: "mobhunter",
    applyVia: "toggle",
    fields: [
      {
        key: "mode",
        label: "模式",
        type: "select",
        default: "keyword",
        options: [
          { value: "keyword", label: "关键词匹配（只打指定名字）" },
          { value: "all_mobs", label: "全部怪物（黑名单除外）" },
        ],
      },
      {
        key: "keywords",
        label: "关键词（逗号分隔）",
        type: "tags",
        default: [],
        placeholder: "僵尸, 庄稼汉",
        hint: "怪物头顶显示什么就填什么（支持 RPG 全息名牌，颜色码自动忽略）。不填不会开打。",
        showIf: (c) => c.mode !== "all_mobs",
      },
      {
        key: "blacklist",
        label: "黑名单（这些不打）",
        type: "tags",
        default: ["villager", "iron_golem", "snow_golem", "wolf", "cat", "parrot", "allay"],
        hint: "名字含这些词的不动手，默认保护村民/傀儡/宠物。掉落物、盔甲架本来就不会打，不用填。",
        showIf: (c) => c.mode === "all_mobs",
      },
      { key: "attackRange", label: "攻击距离", type: "number", default: 4.5, min: 1, max: 6, step: 0.5 },
      { key: "playerDetectRadius", label: "玩家检测半径", type: "number", default: 16, min: 0, max: 64 },
      {
        key: "safetyEnabled",
        label: "检测到玩家暂停",
        type: "switch",
        default: true,
        hint: "有玩家进入检测半径就停手装老实，离开几秒后恢复。自己站旁边测试时记得先关掉，否则它一直「暂停中」。",
      },
      { key: "canDig", label: "允许破坏方块", type: "switch", default: false },
      { key: "canPlace", label: "允许放置方块", type: "switch", default: false },
    ],
  },
  {
    key: "follow",
    name: "跟随",
    icon: Footprints,
    desc: "持续跟随玩家或指定目标（类 Baritone follow）",
    activeFlag: "follow",
    applyVia: "toggle",
    fields: [
      {
        key: "mode",
        label: "匹配方式",
        type: "select",
        default: "nearest_player",
        options: [
          { value: "nearest_player", label: "最近的玩家" },
          { value: "player", label: "按玩家名" },
          { value: "keyword", label: "按名字关键词（怪/NPC，含全息名牌）" },
        ],
      },
      {
        key: "target",
        label: "目标（玩家名/关键词，「最近的玩家」可留空）",
        type: "tags",
        default: [],
        placeholder: "Steve 或 庄稼汉",
        hint: "按看到的名字填即可，颜色码自动忽略；目标丢失会原地待命并自动重找",
      },
      { key: "distance", label: "跟随距离（格）", type: "number", default: 3, min: 1, max: 10 },
    ],
  },
  {
    key: "trash_cleaner",
    name: "垃圾清理",
    icon: Trash2,
    desc: "自动丢弃指定垃圾物品",
    activeFlag: "trashcleaner",
    applyVia: "toggle",
    fields: [
      {
        key: "items",
        label: "垃圾物品（逗号分隔）",
        type: "tags",
        default: ["rotten_flesh", "poisonous_potato"],
        placeholder: "rotten_flesh, cobblestone",
        registry: "items",
        registryMatch: "includes",
      },
    ],
  },
];

/** 用字段默认值生成初始配置 */
export function defaultConfig(def: ModuleDef): Record<string, unknown> {
  const cfg: Record<string, unknown> = {};
  for (const f of def.fields) cfg[f.key] = f.default;
  return cfg;
}
