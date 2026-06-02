import * as fs from "fs";
import * as crypto from "crypto";
import { dataPath } from "./paths";

/**
 * 获取或生成访问令牌。
 * 优先级：环境变量 ENGINE_TOKEN > data/token 文件 > 新生成并写盘。
 */
export function getOrCreateToken(): string {
  const fromEnv = process.env.ENGINE_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const file = dataPath("token");
  try {
    if (fs.existsSync(file)) {
      const existing = fs.readFileSync(file, "utf8").trim();
      if (existing) return existing;
    }
  } catch {
    /* 忽略读失败，重新生成 */
  }

  const token = crypto.randomBytes(24).toString("hex");
  try {
    fs.writeFileSync(file, token, { mode: 0o600 });
  } catch {
    /* 写盘失败不致命，本次会话用内存令牌 */
  }
  return token;
}
