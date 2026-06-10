import "dotenv/config";
import crypto from "crypto";
import { startEngine, ENGINE_VERSION } from "../server";
import { buildConnectionInfo } from "../net/connectionInfo";
import { botManager } from "../botManager";

// 进程级兜底：单个机器人/脚本/模块的异步异常（定时器/事件回调里抛错）不应拖垮整个引擎进程（所有机器人）。
// 记录但不退出——长期运行的多机器人管理器宁可隔离单点故障，也不要全体掉线。
process.on("unhandledRejection", (reason) => {
  console.error("[引擎] 未处理的 Promise 拒绝（已隔离，进程继续）：", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[引擎] 未捕获异常（已隔离，进程继续）：", err);
});

let shuttingDown = false;

async function main(): Promise<void> {
  const engine = await startEngine();
  const { port, token } = engine;

  // 优雅关停(CORE-3)：停所有 bot（关 mineflayer TCP / 模块定时器 / viewer http+io）、关引擎 io/http server，再退出。
  // Ctrl+C(SIGINT)、docker stop(SIGTERM)、宿主退出共用此路径，避免把连接丢给 OS 留下"幽灵会话"。
  const shutdown = (reason: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`[引擎] ${reason}，正在优雅关停…`);
    try {
      botManager.eachInstance((inst: { stop?: () => void }) => {
        try {
          inst.stop?.();
        } catch {
          /* 单个实例停止失败不影响其它 */
        }
      });
    } catch {
      /* ignore */
    }
    try {
      engine.io.close();
    } catch {
      /* ignore */
    }
    try {
      engine.server.close(() => process.exit(0));
    } catch {
      process.exit(0);
    }
    setTimeout(() => process.exit(0), 3000).unref(); // 兜底：3s 内没关干净就强退
  };
  process.on("SIGINT", () => shutdown("收到 SIGINT"));
  process.on("SIGTERM", () => shutdown("收到 SIGTERM"));

  // 父进程看门狗（内置桌面版）：宿主 app 若被强杀/崩溃（优雅退出钩子来不及杀引擎），
  // 探测到父进程消失就优雅关停（停 bot + 关 server），避免残留 node 进程与幽灵会话。MCBOT_PARENT_PID 由桌面壳传入。
  const parentPid = process.env.MCBOT_PARENT_PID ? Number(process.env.MCBOT_PARENT_PID) : 0;
  if (Number.isFinite(parentPid) && parentPid > 0) {
    setInterval(() => {
      try {
        process.kill(parentPid, 0); // 信号 0 仅探测存活，进程不存在会抛错
      } catch {
        shutdown("宿主进程已退出，内置引擎自行关闭");
      }
    }, 3000).unref();
  }

  const info = await buildConnectionInfo({ version: ENGINE_VERSION, port, token });

  // 令牌打印策略(API-5)：默认只打「指纹」(sha256 前 12 位)，不把明文令牌写进 stdout——
  // 容器/CI 会把 stdout 永久收进日志，明文令牌等于永久凭据泄漏。完整连接串/令牌请走带鉴权的
  // GET /api/connection-info 获取。仅在「交互式终端(TTY)」或显式设 ENGINE_PRINT_TOKEN=1 时才打明文，
  // 方便本地裸跑调试时直接复制。内置桌面版不读 stdout 取令牌（由 Tauri 经 ENGINE_TOKEN 注入、
  // 前端走 engine_info 命令获取），故此变更不影响桌面配对 UX。
  const tokenFingerprint = crypto.createHash("sha256").update(token).digest("hex").slice(0, 12);
  const showPlainToken = process.env.ENGINE_PRINT_TOKEN === "1" || Boolean(process.stdout.isTTY);

  console.log("\n================ SteveDeck 引擎已启动 ================");
  console.log(`版本: ${ENGINE_VERSION}   监听端口: ${port}`);
  if (showPlainToken) {
    console.log(`访问令牌: ${token}`);
    console.log(`连接串: ${info.connectionString}`);
  } else {
    console.log(`访问令牌指纹: sha256:${tokenFingerprint}（明文不打印；设 ENGINE_PRINT_TOKEN=1 可显示）`);
    console.log("完整令牌/连接串：请向带鉴权的 GET /api/connection-info 获取");
  }
  console.log("可用地址:");
  for (const a of info.addresses) console.log(`  - http://${a}:${port}`);
  console.log("移动端：扫描 GET /api/connection-info 返回的二维码即可配对");
  console.log("==========================================================\n");
}

main().catch((err) => {
  console.error("引擎启动失败:", err);
  process.exit(1);
});
