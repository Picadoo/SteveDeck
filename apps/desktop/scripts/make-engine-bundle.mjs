// 生成自包含引擎包：pnpm deploy → 删 bedrock 版本数据 → 精简版去掉 3D 视角 → 带 node.exe
// 用法: node make-engine-bundle.mjs <slim|full>
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../.."); // mc-bot-player 根
const out = path.join(root, "apps/desktop/engine-bundle");
const variant = (process.argv[2] || "slim").toLowerCase();

const log = (m) => console.log(`[engine-bundle:${variant}] ${m}`);
const dirSizeMB = (p) => {
  let s = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else
        try {
          s += fs.statSync(fp).size;
        } catch {}
    }
  };
  try {
    walk(p);
  } catch {}
  return Math.round(s / 1024 / 1024);
};

// 1. 清理 + deploy（生产依赖拍平）
log("清理旧包");
fs.rmSync(out, { recursive: true, force: true });
log("pnpm deploy …");
execSync(`pnpm -C "${root}" --filter=@mcbot/engine deploy --prod --legacy "${out}"`, { stdio: "inherit" });

// 2. 删 bedrock 各版本数据（纯 Java 版用不到；保留 bedrock/common，minecraft-data 加载需要）
const findMcDataData = () => {
  const pnpmDir = path.join(out, "node_modules", ".pnpm");
  const pkg = fs.readdirSync(pnpmDir).find((n) => n.startsWith("minecraft-data@"));
  if (!pkg) return null;
  return path.join(pnpmDir, pkg, "node_modules", "minecraft-data", "minecraft-data", "data");
};
const dataDir = findMcDataData();
if (dataDir && fs.existsSync(path.join(dataDir, "bedrock"))) {
  for (const d of fs.readdirSync(path.join(dataDir, "bedrock"))) {
    if (d !== "common") fs.rmSync(path.join(dataDir, "bedrock", d), { recursive: true, force: true });
  }
  log("已删 bedrock 各版本数据（保留 common）");
}

// 3. 精简版：去掉 3D 视角相关大包（bot_viewer 会优雅降级）
if (variant === "slim") {
  const pnpmDir = path.join(out, "node_modules", ".pnpm");
  const heavy = ["prismarine-viewer", "canvas", "three"];
  // 顶层符号链接
  for (const h of heavy) {
    const link = path.join(out, "node_modules", h);
    try {
      fs.rmSync(link, { recursive: true, force: true });
    } catch {}
  }
  // .pnpm 实体
  for (const name of fs.readdirSync(pnpmDir)) {
    if (heavy.some((h) => name.startsWith(h + "@"))) {
      fs.rmSync(path.join(pnpmDir, name), { recursive: true, force: true });
    }
  }
  log("精简版：已移除 prismarine-viewer / canvas / three");
}

// 3.5 完整版：裁剪 3D 视角材质——prismarine-viewer 自带 16 个版本的 blocksStates(110MB)+textures(77MB)，
//      但每个 bot 只用自己版本。只保留常用版本，体积可从 ~248MB 砍到 ~75-120MB。
//      （worker.js 61MB 是浏览器端渲染器代码，必须保留。）可用 ENGINE_VIEWER_VERSIONS 覆盖保留集。
if (variant === "full") {
  const keep = new Set(
    (process.env.ENGINE_VIEWER_VERSIONS || "1.8.8,1.12.2,1.16.4,1.18.1,1.20.1")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const pnpmDir = path.join(out, "node_modules", ".pnpm");
  const pvName = fs.existsSync(pnpmDir) && fs.readdirSync(pnpmDir).find((n) => n.startsWith("prismarine-viewer@"));
  const pub = pvName && path.join(pnpmDir, pvName, "node_modules", "prismarine-viewer", "public");
  if (pub && fs.existsSync(pub)) {
    const before = dirSizeMB(pub);
    const isVer = (v) => /^\d+\.\d+/.test(v); // 仅动版本号命名的条目，避免误删 entity 等公共资源
    for (const sub of ["blocksStates", "textures"]) {
      const dir = path.join(pub, sub);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        const v = f.replace(/\.(json|png)$/, "");
        if (isVer(v) && !keep.has(v)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
      }
    }
    log(`完整版：视角材质裁剪 ${before}→${dirSizeMB(pub)} MB（保留 ${[...keep].join("/")}）`);
  }
}

// 4. 带上 node.exe（用当前 Node 运行时；napi 预编译二进制 ABI 稳定）
const nodeExe = process.execPath;
fs.copyFileSync(nodeExe, path.join(out, path.basename(nodeExe)));
log(`已复制运行时: ${path.basename(nodeExe)}`);

log(`完成，体积 ${dirSizeMB(out)} MB  ->  ${out}`);
