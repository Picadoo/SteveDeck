/* 图标解析审计：直接调用生产模块（dist/textures/icons.js，需先 pnpm build），
   统计各版本 minecraft-data 物品/方块里解析不到贴图的名字（背包/GUI 里显示灰包裹图标的那些）。
   改 icons.ts 的别名/规则后重跑，量化命中率变化。
   用法: node test/icon-audit.cjs [version...]   默认 1.12.2 1.16.4 1.20.1 */
const fs = require("fs");
const path = require("path");
const { resolveIconIn } = require("../dist/textures/icons.js");

const pvDir = path.dirname(require.resolve("prismarine-viewer/package.json"));
const texRoot = path.join(pvDir, "public", "textures");

function audit(version) {
  const dir = path.join(texRoot, version);
  if (!fs.existsSync(dir)) {
    console.log(`\n== ${version}: 无贴图目录,跳过 ==`);
    return;
  }
  const listing = (sub) => {
    try {
      return new Set(fs.readdirSync(path.join(dir, sub)).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4)));
    } catch {
      return new Set();
    }
  };
  const idx = { items: listing("items"), blocks: listing("blocks"), dir };

  let mcData;
  try {
    mcData = require("minecraft-data")(version);
  } catch {
    console.log(`\n== ${version}: 无 minecraft-data ==`);
    return;
  }
  const missItems = [];
  for (const it of mcData.itemsArray || []) if (!resolveIconIn(idx, it.name)) missItems.push(it.name);
  const missBlocks = [];
  for (const bl of mcData.blocksArray || []) {
    if (missItems.includes(bl.name)) continue;
    if (!resolveIconIn(idx, bl.name)) missBlocks.push(bl.name);
  }
  const totI = (mcData.itemsArray || []).length;
  console.log(`\n== ${version}: 物品 ${totI - missItems.length}/${totI} 命中 (${Math.round(((totI - missItems.length) / totI) * 100)}%), 另有 ${missBlocks.length} 个纯方块缺失 ==`);
  if (missItems.length) console.log(`物品缺失(${missItems.length}): ${missItems.join(", ")}`);
  if (missBlocks.length) console.log(`纯方块缺失(${missBlocks.length}): ${missBlocks.join(", ")}`);
}

const versions = process.argv.slice(2);
for (const v of versions.length ? versions : ["1.12.2", "1.16.4", "1.20.1"]) audit(v);
