import * as path from "path";
import * as fs from "fs";

/** 运行时数据目录（令牌、机器人配置、脚本）。Docker 中挂卷到 /data。 */
export function dataDir(): string {
  const dir = process.env.MCBOT_DATA_DIR || path.resolve(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function dataPath(...segments: string[]): string {
  return path.join(dataDir(), ...segments);
}
