/* 图标解析单测：版本就近回退 + 命名规则管线 + 对真实贴图目录的抽查。
   需先 pnpm build（测编译产物 dist/）。 */
const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert");
const { resolveTextureVersion, candidateNames, resolveIconIn } = require("../dist/textures/icons.js");

test("resolveTextureVersion：版本就近回退", () => {
  const avail = ["1.8.8", "1.12.2", "1.16.1", "1.16.4", "1.20.1", "1.21.1", "1.21.4"];
  assert.equal(resolveTextureVersion("1.16.4", avail), "1.16.4", "精确命中");
  assert.equal(resolveTextureVersion("1.16.5", avail), "1.16.4", "同大版本取 ≤ 的最高");
  assert.equal(resolveTextureVersion("1.16.2", avail), "1.16.1", "同大版本就近向下");
  assert.equal(resolveTextureVersion("1.16", avail), "1.16.1", "无更低时取该大版本最低");
  assert.equal(resolveTextureVersion("1.19.2", avail), "1.16.4", "无同大版本 → 全局 ≤ 的最高");
  assert.equal(resolveTextureVersion("1.21.9", avail), "1.21.4");
  assert.equal(resolveTextureVersion("1.7.10", avail), "1.8.8", "比最低还低 → 全局最低");
  assert.equal(resolveTextureVersion("banana", avail), null, "非版本形态不解析（防缓存污染）");
  assert.equal(resolveTextureVersion("1.12.2", []), null);
});

test("candidateNames：通用命名变换规则", () => {
  const has = (name, expect) =>
    assert.ok(candidateNames(name).includes(expect), `${name} 应产出候选 ${expect}（实际 ${candidateNames(name).join("/")}）`);
  has("wheat_seeds", "seeds_wheat"); // 词序颠倒
  has("water_bucket", "bucket_water");
  has("golden_rail", "rail_golden");
  has("wooden_door", "door_wood"); // wooden→wood 后再颠倒
  has("brick_block", "brick"); // 去 _block
  has("infested_stone", "stone"); // 去 infested_
  has("stripped_oak_wood", "stripped_oak_log"); // _wood→_log
  has("crimson_hyphae", "crimson_stem");
  has("oak_slab", "oak_planks"); // 结构后缀 → 基材变体
  has("stone_brick_wall", "stone_bricks");
  has("white_carpet", "white_wool"); // 颜色系近似
  has("magenta_shulker_box", "shulker_top_magenta");
  has("zombie_spawn_egg", "spawn_egg");
  has("silver_glazed_terracotta", "glazed_terracotta_silver");
});

// 对真实贴图目录抽查（prismarine-viewer 随依赖安装，dev/CI 必有；精简运行时无此包才跳过）
function indexOf(version) {
  let texRoot;
  try {
    texRoot = path.join(path.dirname(require.resolve("prismarine-viewer/package.json")), "public", "textures");
  } catch {
    return null;
  }
  const dir = path.join(texRoot, version);
  if (!fs.existsSync(dir)) return null;
  const listing = (sub) => {
    try {
      return new Set(fs.readdirSync(path.join(dir, sub)).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4)));
    } catch {
      return new Set();
    }
  };
  return { items: listing("items"), blocks: listing("blocks"), dir };
}

test("resolveIconIn：1.12.2 真实目录抽查", { skip: !indexOf("1.12.2") }, () => {
  const idx = indexOf("1.12.2");
  assert.equal(resolveIconIn(idx, "wheat_seeds"), "items/seeds_wheat");
  assert.equal(resolveIconIn(idx, "water_bucket"), "items/bucket_water");
  assert.equal(resolveIconIn(idx, "wooden_door"), "items/door_wood");
  assert.equal(resolveIconIn(idx, "wool"), "blocks/wool_colored_white");
  assert.equal(resolveIconIn(idx, "white_shulker_box"), "blocks/shulker_top_white");
  assert.equal(resolveIconIn(idx, "chest_minecart"), "items/minecart_chest");
  assert.equal(resolveIconIn(idx, "diamond_sword"), "items/diamond_sword", "常规物品不受规则影响");
});

test("resolveIconIn：1.16.4 真实目录抽查", { skip: !indexOf("1.16.4") }, () => {
  const idx = indexOf("1.16.4");
  assert.equal(resolveIconIn(idx, "oak_slab"), "blocks/oak_planks");
  assert.equal(resolveIconIn(idx, "zombie_spawn_egg"), "items/spawn_egg");
  assert.equal(resolveIconIn(idx, "white_carpet"), "blocks/white_wool");
  assert.equal(resolveIconIn(idx, "stone_brick_wall"), "blocks/stone_bricks");
  assert.equal(resolveIconIn(idx, "stripped_oak_wood"), "blocks/stripped_oak_log");
});
