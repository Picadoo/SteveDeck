// 生成自包含引擎包：pnpm deploy（hoisted 扁平依赖）→ 删 bedrock 版本数据 → 精简版去掉 3D 视角 → 带 node.exe
// 用法: node make-engine-bundle.mjs <slim|full>
//
// 关键：用 node-linker=hoisted 让 node_modules 扁平、无符号链接。
// 否则 pnpm 默认的 .pnpm 符号链接/Junction 结构在被 Tauri 复制进资源时会全部断链（Cannot find module）。
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

// 解析包真实目录：优先扁平布局 node_modules/<name>（hoisted），回退 pnpm 的 .pnpm 虚拟store
const pkgDir = (name) => {
  const flat = path.join(out, "node_modules", name);
  if (fs.existsSync(path.join(flat, "package.json"))) return flat;
  const pnpmDir = path.join(out, "node_modules", ".pnpm");
  if (fs.existsSync(pnpmDir)) {
    const hit = fs.readdirSync(pnpmDir).find((n) => n.startsWith(name + "@"));
    if (hit) {
      const p = path.join(pnpmDir, hit, "node_modules", name);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
};

// 统计顶层符号链接数（应为 0，否则复制进资源会断链）
const countTopLinks = () => {
  const nm = path.join(out, "node_modules");
  if (!fs.existsSync(nm)) return -1;
  return fs.readdirSync(nm, { withFileTypes: true }).filter((e) => e.isSymbolicLink()).length;
};

// 1. 清理 + deploy（hoisted：扁平、无符号链接的生产依赖）
log("清理旧包");
fs.rmSync(out, { recursive: true, force: true });
log("pnpm deploy（node-linker=hoisted）…");
execSync(
  `pnpm -C "${root}" --filter=@mcbot/engine deploy --prod --legacy --config.node-linker=hoisted "${out}"`,
  { stdio: "inherit" },
);

// 2. 删 bedrock 各版本数据（纯 Java 版用不到；保留 bedrock/common，minecraft-data 加载需要）
const mdDir = pkgDir("minecraft-data");
const dataDir = mdDir && path.join(mdDir, "minecraft-data", "data");
if (dataDir && fs.existsSync(path.join(dataDir, "bedrock"))) {
  for (const d of fs.readdirSync(path.join(dataDir, "bedrock"))) {
    if (d !== "common") fs.rmSync(path.join(dataDir, "bedrock", d), { recursive: true, force: true });
  }
  log("已删 bedrock 各版本数据（保留 common）");
}

// 3. 精简版：去掉 3D 视角相关大包（bot_viewer 会优雅降级）
if (variant === "slim") {
  const heavy = ["prismarine-viewer", "canvas", "three"];
  const pnpmDir = path.join(out, "node_modules", ".pnpm");
  for (const h of heavy) {
    // 扁平布局下的顶层实体
    try {
      fs.rmSync(path.join(out, "node_modules", h), { recursive: true, force: true });
    } catch {}
    // pnpm 布局下的 .pnpm 实体（若存在）
    if (fs.existsSync(pnpmDir)) {
      for (const name of fs.readdirSync(pnpmDir)) {
        if (heavy.some((x) => name.startsWith(x + "@"))) {
          fs.rmSync(path.join(pnpmDir, name), { recursive: true, force: true });
        }
      }
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
  const pv = pkgDir("prismarine-viewer");
  const pub = pv && path.join(pv, "public");
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

// 5. 自检：顶层不能有符号链接（否则复制进 Tauri 资源必断链）
const links = countTopLinks();
if (links > 0) {
  log(`⚠️ 警告：node_modules 顶层仍有 ${links} 个符号链接，复制后会断链！需检查 node-linker 配置。`);
} else {
  log(`自检通过：node_modules 顶层 0 符号链接（复制安全）`);
}

log(`完成，体积 ${dirSizeMB(out)} MB  ->  ${out}`);
