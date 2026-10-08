import http from "http";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { Server as IOServer } from "socket.io";
import rateLimit from "express-rate-limit";
import {
  DEFAULT_ENGINE_PORT,
  type HandshakeAuth,
  ServerEvents,
  PROTOCOL_VERSION,
} from "@mcbot/protocol";
import { getOrCreateToken } from "./config/token";
import { buildConnectionInfo } from "./net/connectionInfo";
import { botManager } from "./botManager";
import { registerHandlers } from "./api/handlers";
import { buildObservation } from "./ai/observe";
import { loadAiConfig, saveAiConfig, generateScript, runAgent } from "./ai/generate";
import { loadNotifyConfig, saveNotifyConfig, sendNotification } from "./notify/webhook";
import { registerTextureRoutes } from "./textures/icons";

// 版本单一来源：引擎 package.json（发版时只改它，/health、engine:info、connection-info 全跟着走）
export const ENGINE_VERSION: string = (() => {
  try {
    return require("../package.json").version || "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

// 令牌比较走常量时间(CORE-6)：明文 `!==` 会因「首个不同字节即返回」泄漏比较耗时，
// 可被用于逐字节侧信道爆破令牌。timingSafeEqual 要求等长缓冲区，长度不同会抛错——
// 故先判长度（长度本身非敏感），再用 utf8 字节做常量时间比较。
function safeEqualToken(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export interface EngineOptions {
  port?: number;
  token?: string;
}

export interface EngineHandle {
  app: express.Express;
  server: http.Server;
  io: IOServer;
  port: number;
  token: string;
}

export async function startEngine(opts: EngineOptions = {}): Promise<EngineHandle> {
  const envPort = process.env.PORT ? Number(process.env.PORT) : undefined;
  const port = opts.port ?? envPort ?? DEFAULT_ENGINE_PORT;
  const token = opts.token ?? getOrCreateToken();

  const app = express();
  app.use(cors());
  app.use(express.json());

  // 鉴权限流(CORE-6)：挂在所有「需要令牌」的 HTTP 路由前，按来源 IP 限速令牌尝试，
  // 给暴力猜令牌设上界。阈值放宽到 120/min——正常前端轮询(快照/感知/视角)远低于此，
  // 但仍能挡住每秒数十次的爆破。仅对鉴权路由生效，不影响 /health 与公开贴图。
  const authLimiter = rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });

  function requireToken(req: Request, res: Response, next: NextFunction): void {
    const header = String(req.headers["authorization"] || "");
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
    // 常量时间比较，避免按比较耗时侧信道爆破令牌
    if (!safeEqualToken(bearer, token)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  }

  // 鉴权路由统一守卫：先限流(挡爆破)再校验令牌。所有需令牌的 HTTP 端点都挂这一组，
  // 避免逐个路由漏挂限流（之前仅 /api/connection-info 有限流）。
  const authGuard: express.RequestHandler[] = [authLimiter, requireToken];

  // 网页客户端检测（挂载在所有路由之后，见文件下方）：找得到 UI 构建产物则
  // 手机/平板浏览器打开 http://<引擎>:<端口>/ 即是完整客户端（零安装）。
  // 查找顺序：MCBOT_UI_DIST 显式指定 → 仓库布局(packages/ui/dist) → 部署布局(<cwd>/ui-dist)。
  const uiDistCandidates = [
    process.env.MCBOT_UI_DIST,
    path.join(__dirname, "../../ui/dist"),
    path.join(process.cwd(), "ui-dist"),
  ].filter(Boolean) as string[];
  const uiDist = uiDistCandidates.find((p) => {
    try {
      return fs.existsSync(path.join(p, "index.html"));
    } catch {
      return false;
    }
  });

  app.get("/health", (_req: Request, res: Response): void => {
    res.json({ status: "ok", uptime: Math.floor(process.uptime()), version: ENGINE_VERSION });
  });

  app.get(
    "/api/connection-info",
    authGuard,
    async (_req: Request, res: Response): Promise<void> => {
      res.json(await buildConnectionInfo({ version: ENGINE_VERSION, port, token, uiServed: !!uiDist }));
    },
  );

  app.get("/api/bots", authGuard, (_req: Request, res: Response): void => {
    res.json({ bots: botManager.buildSnapshot() });
  });

  // 引擎自身资源占用（前端侧栏定时展示）。CPU% = 两次调用间 user+system 增量 / 墙钟（单核 100 制）；
  // 首次调用窗口 = 进程启动至今的平均。只算本引擎进程，不看宿主机其他程序。
  let statsLastCpu = process.cpuUsage();
  let statsLastAt = Date.now();
  app.get("/api/engine-stats", authGuard, (_req: Request, res: Response): void => {
    const nowMs = Date.now();
    const cu = process.cpuUsage();
    const elapsedMs = Math.max(1, nowMs - statsLastAt);
    const cpuPct = Math.round(((cu.user - statsLastCpu.user + cu.system - statsLastCpu.system) / 1000 / elapsedMs) * 100);
    statsLastCpu = cu;
    statsLastAt = nowMs;
    const mem = process.memoryUsage();
    res.json({
      cpuPct: Math.max(0, Math.min(999, cpuPct)),
      rssMB: Math.round(mem.rss / 1048576),
      heapMB: Math.round(mem.heapUsed / 1048576),
      uptimeSec: Math.floor(process.uptime()),
    });
  });

  // 物品/方块贴图：静态服务 + 图标解析端点。逻辑在 textures/icons.ts——
  // 版本就近回退（1.16.5/1.20.4 等无同名目录时不再全量 404）+ 命名规则管线（词序/结构后缀/颜色系等）。
  registerTextureRoutes(app);

  // ===== AI 接口：感知世界状态 + 提交脚本 =====
  app.get("/api/observe/:id", authGuard, (req: Request, res: Response): void => {
    const obs = buildObservation(String(req.params.id));
    if (!obs) {
      res.status(404).json({ error: "bot not found" });
      return;
    }
    res.json(obs);
  });

  // 主动探索：用背包里某个名字的物品打开 GUI，抓取完整内容后关闭，返回结构（AI 可据此搞清服务器定制菜单）。
  // GET /api/explore/:id?item=自助菜单   或不带 item → 列出可探查的菜单候选物品
  app.post("/api/explore/:id", authGuard, async (req: Request, res: Response): Promise<void> => {
    const inst = botManager.getInstance(String(req.params.id));
    if (!inst) {
      res.status(404).json({ error: "bot not found" });
      return;
    }
    const item = String(req.query.item || req.body?.item || "");
    try {
      if (!item) {
        res.json({ candidates: inst.listMenuCandidates?.() ?? [] });
        return;
      }
      const result = await inst.exploreMenuItem(item, {
        keep: !!req.body?.keep,
        clickPath: Array.isArray(req.body?.clickPath) ? req.body.clickPath : undefined,
      });
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message ?? e) });
    }
  });

  // AI 直连配置：key 只存引擎数据目录，读取永不回传明文（仅 hasKey）
  app.get("/api/ai/config", authGuard, (_req: Request, res: Response): void => {
    const c = loadAiConfig();
    res.json({ baseUrl: c.baseUrl, model: c.model, hasKey: !!c.apiKey });
  });
  app.post("/api/ai/config", authGuard, (req: Request, res: Response): void => {
    const b = req.body || {};
    const saved = saveAiConfig({
      baseUrl: typeof b.baseUrl === "string" ? b.baseUrl : undefined,
      model: typeof b.model === "string" ? b.model : undefined,
      apiKey: typeof b.apiKey === "string" ? b.apiKey : undefined,
    });
    res.json({ baseUrl: saved.baseUrl, model: saved.model, hasKey: !!saved.apiKey });
  });

  // ===== Webhook 挂机通知：死亡/被踢/掉线(放弃重连)/上线 推送到钉钉/飞书/企业微信/Discord/Server酱/Bark =====
  app.get("/api/notify/config", authGuard, (_req: Request, res: Response): void => {
    res.json(loadNotifyConfig());
  });
  app.post("/api/notify/config", authGuard, (req: Request, res: Response): void => {
    const b = req.body || {};
    // 只挑已知键（sanitize 再做类型/白名单收口），不把任意客户端键写进配置文件
    res.json(
      saveNotifyConfig({
        enabled: b.enabled,
        url: b.url,
        preset: b.preset,
        events: b.events,
        cooldownSec: b.cooldownSec,
      }),
    );
  });
  // 测试推送：用当前已保存的配置发一条测试消息，直接返回渠道侧的成败（配置页「测试」按钮用）
  app.post("/api/notify/test", authGuard, async (_req: Request, res: Response): Promise<void> => {
    const cfg = loadNotifyConfig();
    const r = await sendNotification(cfg, {
      kind: "test",
      message: "这是一条测试通知——收到说明挂机推送已配置成功",
    });
    if (r.ok) res.json({ ok: true });
    else res.status(400).json({ ok: false, error: r.error });
  });

  // AI 直连生成：感知+目标 → DeepSeek/OpenAI 兼容接口 → 校验过的脚本 JSON（不自动保存，UI 决定导入/运行）
  app.post("/api/ai/generate/:id", authGuard, async (req: Request, res: Response): Promise<void> => {
    try {
      const { script, warnings } = await generateScript(String(req.params.id), String(req.body?.goal ?? ""));
      res.json({ script, warnings });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message ?? e) });
    }
  });

  // AI Agent 闭环：生成→运行→观测→修正，SSE 实时推送进度
  app.post("/api/ai/agent/:id", authGuard, async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params.id);
    const goal = String(req.body?.goal ?? "");
    const maxRounds = Number(req.body?.maxRounds) || 3;
    const waitSec = Number(req.body?.waitSec) || 15;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // 客户端断开（关页面/断网）即置位：runAgent 每阶段检查，不再让 bot 在没人看的情况下继续被 AI 驱动
    let clientGone = false;
    req.on("close", () => {
      clientGone = true;
    });

    const send = (data: any) => {
      if (!res.destroyed) res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    try {
      const result = await runAgent(id, goal, {
        maxRounds,
        waitSec,
        onProgress: (p) => send({ type: "progress", ...p }),
        shouldStop: () => clientGone,
      });
      send({ type: "result", ...result });
    } catch (e: any) {
      send({ type: "error", message: String(e?.message ?? e) });
    }
    res.end();
  });

  app.post("/api/ai/script/:id", authGuard, (req: Request, res: Response): void => {
    const id = String(req.params.id);
    const body = req.body || {};
    const script = body.script ?? body;
    if (!script?.name || !Array.isArray(script.steps)) {
      res.status(400).json({ error: "invalid script: need { name, steps[] }" });
      return;
    }
    const lib = botManager.loadScripts();
    lib[script.name] = script;
    botManager.saveScripts(lib);
    botManager.eachInstance((inst) => inst.preloadScripts?.(lib));
    let started = false;
    if (body.run !== false) {
      const inst = botManager.getInstance(id);
      if (inst?.startScript) {
        try {
          inst.preloadScripts?.(lib);
          inst.startScript(script.name);
          started = true;
        } catch {
          /* ignore */
        }
      }
    }
    res.json({ ok: true, saved: script.name, started });
  });

  // ===== 网页客户端：UI 构建产物直接从引擎端口送出（注册在所有 API 路由之后，不抢路径）=====
  if (uiDist) {
    app.use(express.static(uiDist, { maxAge: "1h", index: "index.html" }));
    // SPA 回退：非 API/socket/贴图 的 GET+期望 HTML 请求一律回 index.html（刷新/深链不 404）。
    // 用 readFile 而非 sendFile：express5 的 sendFile 对绝对路径有怪异 NotFound（同贴图路由的教训）。
    const indexHtml = path.join(uiDist, "index.html");
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== "GET") return next();
      const p = req.path;
      if (p.startsWith("/api") || p.startsWith("/socket.io") || p.startsWith("/textures") || p === "/health")
        return next();
      if (!String(req.headers.accept || "").includes("text/html")) return next();
      try {
        res.type("html").send(fs.readFileSync(indexHtml));
      } catch {
        next();
      }
    });
    console.log(`[engine] 网页客户端已挂载: ${uiDist}（浏览器直接打开引擎地址即可使用）`);
  }

  const server = http.createServer(app);
  const io = new IOServer(server, { cors: { origin: "*" } });

  // socket 握手失败限流(CORE-6)：express-rate-limit 只管 HTTP，握手得自己挡爆破。
  // 按来源 IP 计「失败」次数的滑动窗口；成功握手不计数，故正常配对/重连不受影响。
  // 同窗口内失败超阈值则直接拒绝握手（含正确令牌也先挡住，逼退每秒猛试令牌的攻击者）。
  const HANDSHAKE_FAIL_MAX = 30; // 每窗口允许的失败次数
  const HANDSHAKE_WINDOW_MS = 60_000;
  const handshakeFails = new Map<string, { count: number; resetAt: number }>();
  function handshakeRateExceeded(ip: string): boolean {
    const now = Date.now();
    const rec = handshakeFails.get(ip);
    if (!rec || now >= rec.resetAt) return false; // 窗口已过则不算超限（下次失败时重置）
    return rec.count >= HANDSHAKE_FAIL_MAX;
  }
  function noteHandshakeFail(ip: string): void {
    const now = Date.now();
    const rec = handshakeFails.get(ip);
    if (!rec || now >= rec.resetAt) {
      handshakeFails.set(ip, { count: 1, resetAt: now + HANDSHAKE_WINDOW_MS });
    } else {
      rec.count++;
    }
    // 顺手清理过期条目，避免 Map 随陌生 IP 无界增长
    if (handshakeFails.size > 1024) {
      for (const [k, v] of handshakeFails) if (now >= v.resetAt) handshakeFails.delete(k);
    }
  }

  // 令牌握手鉴权（常量时间比较 + 失败限流）
  io.use((socket, next) => {
    const ip = socket.handshake.address || "unknown";
    if (handshakeRateExceeded(ip)) {
      next(new Error("too many attempts"));
      return;
    }
    const auth = socket.handshake.auth as HandshakeAuth;
    if (!auth || typeof auth.token !== "string" || !safeEqualToken(auth.token, token)) {
      noteHandshakeFail(ip);
      next(new Error("unauthorized"));
      return;
    }
    next();
  });

  botManager.init(io);

  io.on("connection", (socket) => {
    socket.emit(ServerEvents.ENGINE_INFO, {
      version: ENGINE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
    });
    registerHandlers(io, socket);
  });

  // 默认绑 127.0.0.1（仅本机回环，最小暴露面，CORE-6）：默认安全，不主动把带令牌的引擎
  // 挂到局域网/公网。需对外可达的场景（Docker、远程引擎、手机扫码连）显式设
  // ENGINE_HOST=0.0.0.0（或指定网卡 IP）即可放开。内置桌面版本就传 ENGINE_HOST=127.0.0.1，行为不变。
  const host = process.env.ENGINE_HOST || "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    // 绑定失败（EADDRINUSE 等）必须 reject：只 resolve 的话错误落进 uncaughtException
    // 的「记录但继续」兜底——进程活着但永不监听，桌面壳/Docker 只看到一个静默挂起的僵尸引擎
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  botManager.startAll();

  return { app, server, io, port, token };
}
