import * as fs from "fs";
import { dataPath } from "./config/paths";
import { BotConfig } from "@mcbot/protocol";

function botsFile(): string {
  return dataPath("bots.json");
}

/** 读取机器人配置列表（无数据库，纯 JSON）。 */
export function loadBots(): BotConfig[] {
  try {
    const file = botsFile();
    if (!fs.existsSync(file)) return [];
    const text = fs.readFileSync(file, "utf8");
    return text ? (JSON.parse(text) as BotConfig[]) : [];
  } catch {
    return [];
  }
}

/** 原子写盘（临时文件 + rename）。 */
export function saveBots(bots: BotConfig[]): void {
  const file = botsFile();
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(bots, null, 2));
  fs.renameSync(tmp, file);
}
