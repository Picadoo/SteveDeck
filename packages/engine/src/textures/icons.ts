// 物品/方块图标解析与静态贴图服务（从 server.ts 抽出）。
// 贴图源：prismarine-viewer 自带的逐版本 PNG（textures/<版本>/items|blocks/*.png）。
// 两大难点：
//  1) 版本目录只有 16 个固定名（1.12.2/1.16.4/…），而服务器真实版本是任意小版本
//     （1.16.5/1.19.2/1.20.4…）——此前精确匹配不到就全量 404，背包整页灰图标。
//     现在按「同大版本优先、其次就近较旧、再次最旧的较新」回退到最接近的已有目录。
//  2) 物品 id 与贴图文件名的命名差异（1.12 旧命名 / 1.13+ 扁平化 / 结构方块无整图）——
//     用「通用变换规则管线 + 显式别名」解析，审计脚本 test/icon-audit.cjs 可量化命中率。
import * as fs from "fs";
import * as path from "path";
import type { Express, Request, Response } from "express";

// 显式别名（规则管线覆盖不到的个例）。值可以是数组：依次尝试（兼容不同版本命名）。
// 可带子目录（如 entity/xxx）：模型渲染物品取实体贴图近似。
export const ICON_ALIAS: Record<string, string | string[]> = {
  totem_of_undying: "totem",
  golden_apple: "apple_golden",
  enchanted_golden_apple: ["golden_apple", "apple_golden"],
  golden_carrot: "carrot_golden",
  cooked_beef: "beef_cooked",
  cooked_porkchop: "porkchop_cooked",
  cooked_chicken: "chicken_cooked",
  cooked_mutton: "mutton_cooked",
  cooked_rabbit: "rabbit_cooked",
  cooked_fish: "fish_cod_cooked",
  cooked_salmon: "fish_salmon_cooked",
  fish: "fish_cod_raw",
  redstone: "redstone_dust",
  bow: "bow_standby",
  slime_ball: "slimeball",
  tripwire_hook: "trip_wire_source",
  fishing_rod: "fishing_rod_uncast",
  filled_map: "map_filled",
  map: "map_empty",
  potion: "potion_bottle_drinkable",
  splash_potion: "potion_bottle_splash",
  lingering_potion: "potion_bottle_lingering",
  glass_bottle: "potion_bottle_empty",
  experience_bottle: "experience_bottle",
  melon: "melon_speckled",
  speckled_melon: "melon_speckled",
  cocoa_beans: "dye_powder_brown",
  // 盔甲架物品图标在 1.12.2 资源里叫 wooden_armorstand（带 wooden_ 前缀、无下划线）
  armor_stand: "wooden_armorstand",
  // 盾牌是模型渲染物品，1.12.2 无 items/shield.png，用实体贴图(无花纹底版)近似
  shield: "entity/shield_base_nopattern",
  // 染料：1.12.2 按 metadata 分色(dye_powder_*)，无统一 dye.png。此处兜底，精确颜色由物品同步按 metadata 处理
  dye: "dye_powder_white",
  ink_sac: "dye_powder_black",
  red_flower: "flower_rose",
  yellow_flower: "flower_dandelion",
  double_plant: "double_plant_sunflower_front",
  // 箱子是实体渲染、无平面图，用木板近似（1.12 旧名 / 1.13+ 新名）
  chest: ["planks_oak", "oak_planks"],
  trapped_chest: ["planks_oak", "oak_planks"],
  ender_chest: "obsidian",
  // 玻璃板/有色玻璃(菜单边框常用)：无 id 整图、且无 metadata 分色 → 统一用透明玻璃近似
  stained_glass_pane: "glass",
  glass_pane: "glass",
  thin_glass: "glass",
  stained_glass: "glass",
  // 旧版不规则命名
  book: "book_normal",
  written_book: "book_written",
  writable_book: "book_writable",
  enchanted_book: "book_enchanted",
  chicken: "chicken_raw",
  planks: "planks_oak",
  log: "log_oak",
  log2: "log_acacia",
  leaves: "leaves_oak",
  leaves2: "leaves_acacia",
  snow_layer: "snow",
  stone_button: "stone",
  wooden_button: "planks_oak",
  wooden_slab: "planks_oak",
  wooden_pressure_plate: "planks_oak",
  fence: "planks_oak",
  fence_gate: "planks_oak",
  sapling: "sapling_oak",
  tallgrass: "tallgrass",
  waterlily: "waterlily",
  deadbush: "deadbush",
  // 楼梯精确映射（1.12 命名与规则管线推不出的：stonebrick 无下划线、sandstone_normal 等）
  quartz_stairs: "quartz_block_side",
  stone_brick_stairs: ["stonebrick", "stone_bricks"],
  sandstone_stairs: ["sandstone_normal", "sandstone"],
  red_sandstone_stairs: ["red_sandstone_normal", "red_sandstone"],
  purpur_stairs: "purpur_block",
  purpur_slab: "purpur_block",
  petrified_oak_slab: ["oak_planks", "planks_oak"],
  dark_oak_stairs: ["planks_big_oak", "dark_oak_planks"],
  // —— 审计补充（test/icon-audit.cjs 找出的成片缺失）——
  sticky_piston: "piston_top_sticky",
  monster_egg: "stone", // 蠹虫方块（伪装成石头）
  end_portal_frame: "endframe_side",
  prismarine: "prismarine_rough",
  lit_pumpkin: "pumpkin_face_on",
  fire_charge: "fireball",
  firework_charge: "fireworks_charge",
  tipped_arrow: "arrow",
  debug_stick: "stick",
  stone_slab2: "red_sandstone_normal",
  light_weighted_pressure_plate: "gold_block",
  heavy_weighted_pressure_plate: "iron_block",
  brown_mushroom_block: "mushroom_block_skin_brown",
  red_mushroom_block: "mushroom_block_skin_red",
  stained_hardened_clay: "hardened_clay_stained_white",
  // 羊毛/混凝土系（1.12 物品无分色 metadata 图，取白色代表）
  wool: "wool_colored_white",
  carpet: "wool_colored_white",
  concrete: "concrete_white",
  concrete_powder: "concrete_powder_white",
  // 床/旗帜是实体渲染无平面图 → 用颜色近似（1.12 默认床是红色）
  bed: "wool_colored_red",
  banner: "wool_colored_white",
  boat: "oak_boat", // 1.12.2 贴图里已是现代名
  redstone_lamp: "redstone_lamp_off",
  farmland: "farmland_dry",
  // 头颅系：无平面贴图（实体渲染），映射到近似材质避免灰块
  skull: "bone",
  smooth_quartz: "quartz_block_bottom",
  smooth_sandstone: "sandstone_top",
  smooth_red_sandstone: "red_sandstone_top",
  dried_kelp_block: "dried_kelp_top",
};

const MC_COLORS = [
  "white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
  "light_gray", "silver", "cyan", "purple", "blue", "brown", "green", "red", "black",
];
const COLOR_PREFIX = new RegExp(`^(${MC_COLORS.join("|")})_(.+)$`);

/** 结构性后缀（楼梯/台阶/墙/栅栏/压力板/按钮…无整图）：剥掉后尝试基材。 */
const STRUCTURAL_SUFFIX = /_(slab|stairs|wall|fence_gate|fence|pressure_plate|button)$/;

/** 兜底面后缀：多面方块（熔炉/工作台/活板门等）没有同名整图时取一个代表面。 */
const FACE_SUFFIXES = [
  "_on", "_off", "_normal", "_raw", "_dry", "_base", "_empty", "_standby",
  "_front_horizontal", "_front_off", "_front", "_top", "_side", "_bottom",
  "_inventory", "_0", "_oak", "_white", "_colored_white",
];

/**
 * 单轮变换：对一个名字产出所有直接变体。
 * 规则来自审计（1.12.2 缺 25%、1.16.4 缺 28% 的成因分类）：
 *  - 词序颠倒：wheat_seeds→seeds_wheat、water_bucket→bucket_water、spruce_door→door_spruce
 *  - wooden_/golden_ → wood_/gold_（1.12 工具盔甲整族）
 *  - X_block → X（brick_block→brick、magma_block→magma）
 *  - infested_X / waxed_X → X（蠹虫伪装块 / 蜡封铜系）
 *  - X_wood/X_hyphae → X_log/X_stem（原木六面皮）
 *  - 结构后缀（slab/stairs/wall/fence…）→ 基材 / 基材s / 基材_planks / planks_基材
 *  - 颜色_carpet|bed|banner → 颜色_wool（实体渲染/无整图，用羊毛色块近似）；moss_carpet→moss_block
 *  - 颜色_shulker_box → shulker_top_颜色（1.12 命名）
 *  - X_spawn_egg → spawn_egg（1.13+ 刷怪蛋底图运行时染色）
 *  - X_skull/X_head → skull（实体渲染无平面图，经别名近似）
 *  - 上釉陶瓦词序（1.12：glazed_terracotta_颜色）
 */
function transformOnce(name: string): string[] {
  const out: string[] = [];
  const push = (n?: string | null) => {
    if (n && n !== name && !out.includes(n)) out.push(n);
  };

  const renamed = name.replace(/^wooden_/, "wood_").replace(/^golden_/, "gold_");
  push(renamed);

  // 词序颠倒（对原名与 wood/gold 改名后的都试）
  for (const base of [name, renamed]) {
    const w = base.split("_");
    if (w.length >= 2) {
      push([...w.slice(1), w[0]].join("_")); // 首词移尾：golden_rail→rail_golden
      push([w[w.length - 1], ...w.slice(0, -1)].join("_")); // 尾词移首：wheat_seeds→seeds_wheat
    }
  }

  if (name.endsWith("_block")) push(name.slice(0, -6));
  if (name.startsWith("infested_")) push(name.slice(9));
  if (name.startsWith("waxed_")) push(name.slice(6)); // 蜡封铜与本体贴图一致
  if (name.endsWith("_wood")) push(name.slice(0, -5) + "_log");
  if (name.endsWith("_hyphae")) push(name.slice(0, -7) + "_stem");
  if (name.endsWith("_skull") || name.endsWith("_head")) push("skull");

  const colored = name.match(COLOR_PREFIX);
  if (colored) {
    const [, color, rest] = colored;
    if (rest === "carpet" || rest === "bed" || rest === "banner") push(`${color}_wool`);
    if (rest === "shulker_box") push(`shulker_top_${color}`);
  }
  if (name.endsWith("_carpet")) push(name.slice(0, -7) + "_block"); // moss_carpet→moss_block
  if (name.endsWith("_spawn_egg")) push("spawn_egg");

  const st = name.match(STRUCTURAL_SUFFIX);
  if (st) {
    const base = name.slice(0, -(st[1].length + 1));
    push(base);
    push(base + "s"); // brick→bricks、stone_brick→stone_bricks
    push(base + "_planks"); // oak_slab→oak_planks（1.13+）
    push("planks_" + base.replace(/^dark_oak$/, "big_oak")); // 1.12：planks_oak / planks_big_oak
  }

  const gt = name.match(/^(.+)_glazed_terracotta$/);
  if (gt) push(`glazed_terracotta_${gt[1]}`);

  return out;
}

/**
 * 两级展开的候选序列：waxed_cut_copper_slab → cut_copper_slab（一级）→ cut_copper（二级）。
 * 一级候选排前（更接近原名=更可信）；总量有上限（名字短、变换少，实际 ≤ 30）。
 */
export function candidateNames(name: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([name]);
  const add = (n: string) => {
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  };
  const level1 = transformOnce(name);
  for (const c of level1) add(c);
  for (const c of level1) for (const c2 of transformOnce(c)) add(c2);
  return out;
}

// ============ 目录扫描与解析 ============

interface TexDirIndex {
  items: Set<string>;
  blocks: Set<string>;
  dir: string;
}

function indexVersionDir(dir: string): TexDirIndex {
  const listing = (sub: string): Set<string> => {
    try {
      return new Set(
        fs.readdirSync(path.join(dir, sub)).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4)),
      );
    } catch {
      return new Set<string>();
    }
  };
  return { items: listing("items"), blocks: listing("blocks"), dir };
}

/** 在一个版本目录内解析单个名字 → 相对路径（items/xxx | blocks/xxx | entity/...），找不到 null。 */
export function resolveIconIn(idx: TexDirIndex, name: string): string | null {
  const direct = (n: string): string | null => {
    if (idx.items.has(n)) return `items/${n}`;
    if (idx.blocks.has(n)) return `blocks/${n}`;
    if (idx.items.has(`${n}_00`)) return `items/${n}_00`; // 动画物品取首帧
    if (idx.blocks.has(`${n}_00`)) return `blocks/${n}_00`;
    return null;
  };

  const hit = direct(name);
  if (hit) return hit;

  // 显式别名（支持数组与子目录路径）
  const tryAlias = (n: string): string | null => {
    const alias = ICON_ALIAS[n];
    if (!alias) return null;
    for (const a of Array.isArray(alias) ? alias : [alias]) {
      if (a.includes("/")) {
        if (fs.existsSync(path.join(idx.dir, `${a}.png`))) return a;
      } else {
        const h = direct(a);
        if (h) return h;
      }
    }
    return null;
  };
  const aliased = tryAlias(name);
  if (aliased) return aliased;

  // 通用变换规则（候选名本身命中别名也算：smooth_quartz_slab→smooth_quartz→别名 quartz_block_bottom）
  for (const cand of candidateNames(name)) {
    const h = direct(cand) ?? tryAlias(cand);
    if (h) return h;
  }

  // 面后缀兜底（原名 + 变换名都试）
  for (const base of [name, ...candidateNames(name)]) {
    for (const suf of FACE_SUFFIXES) {
      const h = direct(`${base}${suf}`);
      if (h) return h;
    }
  }
  return null;
}

// ============ 版本回退 ============

const verNum = (v: string): number[] => v.split(".").map((n) => parseInt(n, 10) || 0);
const verCmp = (a: string, b: string): number => {
  const x = verNum(a);
  const y = verNum(b);
  return x[0] - y[0] || (x[1] || 0) - (y[1] || 0) || (x[2] || 0) - (y[2] || 0);
};
const majorOf = (v: string): string => {
  const [a, b] = v.split(".");
  return `${a}.${b ?? "0"}`;
};

/**
 * 把请求版本映射到最接近的「实际存在」的贴图目录：
 * 精确命中 → 同大版本内 ≤请求 的最高（否则该大版本最高）→ 全局 ≤请求 的最高 → 全局最低。
 * 修复：1.16.5/1.19.2/1.20.4 等服务器版本没有同名目录时，此前全部图标 404。
 */
export function resolveTextureVersion(requested: string, available: string[]): string | null {
  if (!available.length) return null;
  if (available.includes(requested)) return requested;
  if (!/^\d+\.\d+/.test(requested)) return null; // 非版本形态的乱串不解析（防缓存污染，E11）
  const sorted = [...available].sort(verCmp);
  const sameMajor = sorted.filter((v) => majorOf(v) === majorOf(requested));
  const pick = (list: string[]): string | null => {
    if (!list.length) return null;
    let best: string | null = null;
    for (const v of list) {
      if (verCmp(v, requested) <= 0) best = v;
      else break;
    }
    return best ?? list[0];
  };
  return pick(sameMajor) ?? pick(sorted);
}

// ============ Express 路由挂载 ============

/**
 * 挂载贴图静态服务与图标解析端点（无需鉴权——仅公开贴图）。
 * 精简版引擎缺 prismarine-viewer 时静默跳过（前端 <img> 404 后回退到图标字形）。
 */
export function registerTextureRoutes(app: Express): void {
  let texRoot: string;
  try {
    const pvDir = path.dirname(require.resolve("prismarine-viewer/package.json"));
    texRoot = path.join(pvDir, "public", "textures");
  } catch {
    return; // 精简版无 prismarine-viewer，跳过贴图静态服务
  }

  const express = require("express") as typeof import("express");

  // 真实存在的版本目录（E11：version 是客户端可控 URL 段，一切解析都收敛到这个白名单内）
  const versionDirs: string[] = (() => {
    try {
      return fs.readdirSync(texRoot).filter((d) => {
        try {
          return fs.statSync(path.join(texRoot, d)).isDirectory();
        } catch {
          return false;
        }
      });
    } catch {
      return [];
    }
  })();

  // 图标映射缓存：键为「解析后的真实目录名」，天然有界（≤目录数）
  const iconMapCache: Record<string, Record<string, string>> = {};
  const getIconMap = (version: string): Record<string, string> => {
    if (iconMapCache[version]) return iconMapCache[version];
    const idx = indexVersionDir(path.join(texRoot, version));
    const map: Record<string, string> = {};
    try {
      const mcData = require("minecraft-data")(version);
      for (const it of mcData.itemsArray || []) {
        const p = resolveIconIn(idx, it.name);
        if (p) map[it.name] = p;
      }
      for (const bl of mcData.blocksArray || []) {
        if (map[bl.name]) continue;
        const p = resolveIconIn(idx, bl.name);
        if (p) map[bl.name] = p;
      }
    } catch {
      /* 该版本无 minecraft-data：退化为只认存在的文件名 */
    }
    for (const n of idx.items) if (!map[n]) map[n] = `items/${n}`;
    for (const n of idx.blocks) if (!map[n]) map[n] = `blocks/${n}`;
    iconMapCache[version] = map;
    return map;
  };

  // 解析端点：/textures/1.16.5/_icon/wheat_seeds.png → 302 /textures/1.16.4/items/seeds_wheat.png
  // （版本就近回退 + 命名规则解析，见文件头注释）
  app.get("/textures/:version/_icon/:name", (req: Request, res: Response): void => {
    const resolved = resolveTextureVersion(String(req.params.version), versionDirs);
    if (!resolved) {
      res.set("Cache-Control", "no-store");
      res.status(404).end();
      return;
    }
    const name = String(req.params.name).replace(/\.png$/i, "").toLowerCase();
    const rel = getIconMap(resolved)[name];
    if (!rel) {
      res.set("Cache-Control", "no-store"); // 404 不缓存：新增别名/换版本后立即生效，不被旧 404 卡住
      res.status(404).end();
      return;
    }
    // 重定向到已验证可用的静态贴图（绕开 express5 sendFile 对绝对路径的怪异 NotFound；静态层负责 MIME/缓存）
    res.set("Cache-Control", "public, max-age=604800");
    res.redirect(302, `/textures/${resolved}/${rel}.png`);
  });

  app.use("/textures", express.static(texRoot, { maxAge: "7d", fallthrough: true }));
}
