import "dotenv/config";
import { startEngine, ENGINE_VERSION } from "../server";
import { buildConnectionInfo } from "../net/connectionInfo";

// 进程级兜底：单个机器人/脚本/模块的异步异常（定时器/事件回调里抛错）不应拖垮整个引擎进程（所有机器人）。
// 记录但不退出——长期运行的多机器人管理器宁可隔离单点故障，也不要全体掉线。
process.on("unhandledRejection", (reason) => {
  console.error("[引擎] 未处理的 Promise 拒绝（已隔离，进程继续）：", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[引擎] 未捕获异常（已隔离，进程继续）：", err);
});

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
