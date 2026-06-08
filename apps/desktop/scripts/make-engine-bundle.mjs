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

// variant 必须显式合法，拼错（如 "fll"）不能静默当成"不裁剪"而产出超大/错误包
const VARIANTS = ["slim", "full"];
if (!VARIANTS.includes(variant)) {
  console.error(
    `[engine-bundle] 非法 variant "${process.argv[2] ?? ""}"，只允许 ${VARIANTS.join(" | ")}。用法: node make-engine-bundle.mjs <slim|full>`,
  );
  process.exit(1);
}

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

// 1. deploy（hoisted：扁平、无符号链接的生产依赖）
//    先 deploy 到临时目录、全部成功后再替换正式目录：deploy 失败时旧好包不会被毁（既无新包也无旧包的窘境）。
const tmpOut = out + ".tmp";
log("清理临时目录");
fs.rmSync(tmpOut, { recursive: true, force: true });
const deployCmd = `pnpm -C "${root}" --filter=@mcbot/engine deploy --prod --legacy --config.node-linker=hoisted "${tmpOut}"`;
log("pnpm deploy（node-linker=hoisted）…");
try {
  execSync(deployCmd, { stdio: "inherit" });
} catch (e) {
  fs.rmSync(tmpOut, { recursive: true, force: true }); // 半成品临时目录清掉，旧 out 原样保留
  console.error(`[engine-bundle:${variant}] ❌ pnpm deploy 失败：${e.message}`);
  console.error(`  执行的命令：${deployCmd}`);
  console.error(
    "  排查：确认已 pnpm install；@mcbot/engine 是否存在且已构建（dist/bin/serve.js）；pnpm 版本是否支持 deploy --legacy。旧 engine-bundle 未改动。",
  );
  process.exit(1);
}
// deploy 成功，原子替换：删旧 out → 把临时目录改名为 out。后续步骤继续在 out 上裁剪。
log("替换旧包");
fs.rmSync(out, { recursive: true, force: true });
fs.renameSync(tmpOut, out);

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
if (links < 0) {
  // -1 = node_modules 根本不存在 = 部署失败/空包。必须当硬错误，绝不能走"自检通过"分支。
  console.error(
    `[engine-bundle:${variant}] ❌ 致命：${path.join(out, "node_modules")} 不存在，deploy 未产出依赖，残缺包不可用。`,
  );
  process.exit(1);
}
if (links > 0) {
  log(`⚠️ 警告：node_modules 顶层仍有 ${links} 个符号链接，复制后会断链！需检查 node-linker 配置。`);
} else {
  log(`自检通过：node_modules 顶层 0 符号链接（复制安全）`);
}

// 6. 断言关键产物存在：缺任一项都会在运行时变成 "Cannot find module"，必须在构建期就硬失败而非静默放行。
const nodeModulesEmpty = (() => {
  try {
    return fs.readdirSync(path.join(out, "node_modules")).length === 0;
  } catch {
    return true;
  }
})();
const required = [
  // node.exe：仅在本变体应携带运行时时校验（当前两种变体都带，见下方第 4 步；locate_engine_bundle 也靠它定位包）
  { p: path.join(out, path.basename(nodeExe)), label: "node.exe 运行时" },
  // Rust 侧 lib.rs 实际执行的入口（node.exe dist/bin/serve.js）
  { p: path.join(out, "dist", "bin", "serve.js"), label: "引擎入口 dist/bin/serve.js" },
];
const missing = required.filter((r) => !fs.existsSync(r.p)).map((r) => `${r.label}（${r.p}）`);
if (nodeModulesEmpty) missing.push(`非空 node_modules（${path.join(out, "node_modules")}）`);
if (missing.length) {
  console.error(`[engine-bundle:${variant}] ❌ 关键产物缺失，包残缺，构建失败：`);
  for (const m of missing) console.error(`  - ${m}`);
  process.exit(1);
}
log("产物校验通过：node.exe / dist/bin/serve.js / node_modules 均存在");

log(`完成，体积 ${dirSizeMB(out)} MB  ->  ${out}`);
