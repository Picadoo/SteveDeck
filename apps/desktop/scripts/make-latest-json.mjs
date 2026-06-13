// 生成 Tauri updater 的 latest.json：updater 客户端拉这个文件比对版本，
// 决定是否下载。signature 取自 NSIS 安装包旁的 .sig 文件（CI 用签名私钥生成）。
//
// 用法：node apps/desktop/scripts/make-latest-json.mjs
// 在 tauri build 之后跑（此时 bundle/nsis/ 下已有 *-setup.exe + *-setup.exe.sig）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const root = path.resolve(desktopDir, "../..");

// 版本号取自 tauri.conf.json（单一事实源）
const conf = JSON.parse(fs.readFileSync(path.join(desktopDir, "src-tauri/tauri.conf.json"), "utf8"));
const version = conf.version;

const nsisDir = path.join(desktopDir, "src-tauri/target/release/bundle/nsis");
const files = fs.existsSync(nsisDir) ? fs.readdirSync(nsisDir) : [];

// NSIS 安装包 + 其签名（updater 用 NSIS，比 MSI 适合静默更新）
const setupExe = files.find((f) => f.endsWith("-setup.exe"));
const sigFile = files.find((f) => f.endsWith("-setup.exe.sig"));
if (!setupExe || !sigFile) {
  console.error(`[latest.json] 未找到 NSIS 安装包/签名（nsis 目录: ${files.join(", ") || "空"}）`);
  process.exit(1);
}

const signature = fs.readFileSync(path.join(nsisDir, sigFile), "utf8").trim();

// updater 客户端从 GitHub Release 资产按文件名直取安装包
const owner = "Picadoo";
const repo = "SteveDeck";
const downloadUrl = `https://github.com/${owner}/${repo}/releases/download/v${version}/${encodeURIComponent(setupExe)}`;

const latest = {
  version,
  notes: `SteveDeck v${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: downloadUrl,
    },
  },
};

const outPath = path.join(desktopDir, "latest.json");
fs.writeFileSync(outPath, JSON.stringify(latest, null, 2));
console.log(`[latest.json] 已生成 v${version} → ${outPath}`);
console.log(`  安装包: ${setupExe}`);
console.log(`  下载地址: ${downloadUrl}`);
