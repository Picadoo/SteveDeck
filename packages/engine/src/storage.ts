import * as fs from "fs";
import { dataPath } from "./config/paths";
import { BotConfig } from "@mcbot/protocol";

/**
 * 读 JSON，区分「文件不存在」与「文件损坏」：
 * - 不存在 → 返回 fallback（正常情况）。
 * - 存在但解析失败 → **不静默吞**：把损坏文件改名留档(.corrupt-<时间戳>)、报错，再返回 fallback。
 *   避免后续保存把可恢复的数据覆盖成空（旧实现 catch 直接 return []/{}，是数据丢失隐患）。
 */
function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    console.error(`[storage] 读取失败 ${file}:`, e);
    return fallback;
  }
  if (!text.trim()) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    const corrupt = `${file}.corrupt-${Date.now()}`;
    try {
      fs.copyFileSync(file, corrupt);
    } catch {
      /* 留档失败也不阻断启动 */
    }
    console.error(`[storage] ${file} 解析失败，已留档到 ${corrupt}。请人工恢复后再写入。`, e);
    return fallback;
  }
}

/**
 * 原子写盘（临时文件 + rename）+ 滚动备份：
 * 覆盖前，把现有文件复制为 .bak —— **但仅当现有文件是有效 JSON 时**，
 * 否则会用损坏内容把上一份好备份覆盖掉。这样即便主文件被写空/写坏，.bak 仍保留上一份好数据。
 */
function writeJsonAtomic(file: string, data: unknown): void {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  try {
    if (fs.existsSync(file)) {
      JSON.parse(fs.readFileSync(file, "utf8")); // 解析通过才认为是好数据，值得备份
      fs.copyFileSync(file, file + ".bak");
    }
  } catch {
    /* 现有文件损坏/不可读 → 跳过备份，保留既有好 .bak */
  }
  fs.renameSync(tmp, file);
}

function botsFile(): string {
  return dataPath("bots.json");
}

/** 读取机器人配置列表（无数据库，纯 JSON）。 */
export function loadBots(): BotConfig[] {
  return readJson<BotConfig[]>(botsFile(), []);
}

/** 原子写盘 + 备份。 */
export function saveBots(bots: BotConfig[]): void {
  writeJsonAtomic(botsFile(), bots);
}

// ==================== 脚本库（全局，单主人） ====================
function scriptsFile(): string {
  return dataPath("scripts.json");
}

export function loadScripts(): Record<string, unknown> {
  return readJson<Record<string, unknown>>(scriptsFile(), {});
}

export function saveScripts(scripts: Record<string, unknown>): void {
  writeJsonAtomic(scriptsFile(), scripts);
}

// ==================== 自定义 JS 脚本库（全局，单主人） ====================
function customScriptsFile(): string {
  return dataPath("custom_scripts.json");
}

export function loadCustomScripts(): Record<string, unknown> {
  return readJson<Record<string, unknown>>(customScriptsFile(), {});
}

export function saveCustomScripts(scripts: Record<string, unknown>): void {
  writeJsonAtomic(customScriptsFile(), scripts);
}
