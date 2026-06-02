import "dotenv/config";
import { startEngine, ENGINE_VERSION } from "../server";
import { buildConnectionInfo } from "../net/connectionInfo";

async function main(): Promise<void> {
  const { port, token } = await startEngine();
  const info = await buildConnectionInfo({ version: ENGINE_VERSION, port, token });

  console.log("\n================ mc-bot-player 引擎已启动 ================");
  console.log(`版本: ${ENGINE_VERSION}   监听端口: ${port}`);
  console.log(`访问令牌: ${token}`);
  console.log("可用地址:");
  for (const a of info.addresses) console.log(`  - http://${a}:${port}`);
  console.log(`连接串: ${info.connectionString}`);
  console.log("移动端：扫描 GET /api/connection-info 返回的二维码即可配对");
  console.log("==========================================================\n");
}

main().catch((err) => {
  console.error("引擎启动失败:", err);
  process.exit(1);
});
