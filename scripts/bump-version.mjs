#!/usr/bin/env node
// 版本号统一管理：产品版本散落在多个文件（pnpm 包 / tauri.conf.json / Cargo.toml / Cargo.lock），
// 手改必漏——历史上 desktop package.json 停在 0.1.0、Cargo.toml 停在 0.1.2 就是这么来的。
// UI/protocol 是内部 workspace 库（恒 0.0.0，不发布），不参与产品版本。
//
// 用法：
//   pnpm bump 0.1.4              所有位点写成 0.1.4
//   pnpm bump --check            校验所有位点一致（CI 防再漂移）
//   pnpm bump --check 0.1.4      额外要求等于指定值（release 用 tag 校验，防「tag v0.1.4 发出 0.1.3 的包」）
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// JSON 的顶层 version 字段
const JSON_SPOTS = [
  "package.json",
  "packages/engine/package.json",
  "apps/desktop/package.json",
  "apps/mobile/package.json",
  "apps/desktop/src-tauri/tauri.conf.json",
  "apps/mobile/src-tauri/tauri.conf.json",
];
// Cargo.toml 的 [package] version（首个行首 version= 即是；依赖表里的 version 都在行中）
const CARGO_SPOTS = ["apps/desktop/src-tauri/Cargo.toml", "apps/mobile/src-tauri/Cargo.toml"];

const read = (p) => readFileSync(join(ROOT, p), "utf8");
const write = (p, s) => writeFileSync(join(ROOT, p), s);

/** 收集所有版本位点：{ file, version, apply(v) } */
function collect() {
  const spots = [];
  for (const f of JSON_SPOTS) {
    const raw = read(f);
    // 个别文件带 UTF-8 BOM（如 mobile/package.json）：解析前剥掉，写回时原样保留，不制造无关 diff
    const bom = raw.charCodeAt(0) === 0xfeff ? "\uFEFF" : "";
    const data = JSON.parse(bom ? raw.slice(1) : raw);
    spots.push({
      file: f,
      version: data.version,
      apply(v) {
        data.version = v;
        write(f, `${bom}${JSON.stringify(data, null, 2)}\n`);
      },
    });
  }
  for (const f of CARGO_SPOTS) {
    const raw = read(f);
    const m = raw.match(/^version\s*=\s*"([^"]*)"/m);
    if (!m) throw new Error(`${f} 里找不到 version 字段`);
    spots.push({
      file: f,
      version: m[1],
      apply(v) {
        write(f, raw.replace(/^(version\s*=\s*")[^"]*(")/m, `$1${v}$2`));
      },
    });
    // Cargo.lock 里本包的锁定项要跟着走，否则下次 cargo 构建产生脏 diff
    const name = raw.match(/^name\s*=\s*"([^"]*)"/m)?.[1];
    const lockFile = join(dirname(f), "Cargo.lock");
    if (name && existsSync(join(ROOT, lockFile))) {
      const lock = read(lockFile);
      const re = new RegExp(`(\\[\\[package\\]\\]\\s*name = "${name}"\\s*version = ")([^"]*)(")`);
      const lm = lock.match(re);
      if (lm) {
        spots.push({
          file: `${lockFile.replaceAll("\\", "/")} (${name})`,
          version: lm[2],
          apply(v) {
            write(lockFile, lock.replace(re, `$1${v}$3`));
          },
        });
      }
    }
  }
  return spots;
}

const args = process.argv.slice(2);
const check = args.includes("--check");
const version = args.find((a) => !a.startsWith("-"));
const spots = collect();

if (check) {
  // 无指定值时以根 package.json 为基准
  const expected = version ?? spots[0].version;
  const bad = spots.filter((s) => s.version !== expected);
  if (bad.length) {
    console.error(`✖ 版本不一致（基准 ${expected}${version ? "，来自参数" : "，取自根 package.json"}）：`);
    for (const s of bad) console.error(`    ${s.file}: ${s.version}`);
    console.error("  运行 pnpm bump <x.y.z> 一键同步");
    process.exit(1);
  }
  console.log(`✓ 全部 ${spots.length} 处版本一致：${expected}`);
} else {
  if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
    console.error("用法：pnpm bump <x.y.z>  |  pnpm bump --check [x.y.z]");
    process.exit(2);
  }
  for (const s of spots) {
    console.log(`  ${s.file}: ${s.version} ${s.version === version ? "=" : "→"} ${version}`);
    if (s.version !== version) s.apply(version);
  }
  console.log(`✓ 已同步 ${spots.length} 处版本 → ${version}`);
}
