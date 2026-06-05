import http from "http";
import path from "path";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { Server as IOServer } from "socket.io";
import rateLimit from "express-rate-limit";
import {
  DEFAULT_ENGINE_PORT,
  HandshakeAuth,
  ServerEvents,
  PROTOCOL_VERSION,
} from "@mcbot/protocol";
import { getOrCreateToken } from "./config/token";
import { buildConnectionInfo } from "./net/connectionInfo";
import { botManager } from "./botManager";
import { registerHandlers } from "./api/handlers";
import { buildObservation } from "./ai/observe";

export const ENGINE_VERSION = "0.1.0";

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

  const authLimiter = rateLimit({
    windowMs: 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
  });

  function requireToken(req: Request, res: Response, next: NextFunction): void {
    const header = String(req.headers["authorization"] || "");
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (bearer !== token) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  }

  app.get("/health", (_req: Request, res: Response): void => {
    res.json({ status: "ok", uptime: Math.floor(process.uptime()), version: ENGINE_VERSION });
  });

  app.get(
    "/api/connection-info",
    authLimiter,
    requireToken,
    async (_req: Request, res: Response): Promise<void> => {
      res.json(await buildConnectionInfo({ version: ENGINE_VERSION, port, token }));
    },
  );

  app.get("/api/bots", requireToken, (_req: Request, res: Response): void => {
    res.json({ bots: botManager.buildSnapshot() });
  });

  // 物品/方块贴图：复用 prismarine-viewer 自带的逐版本 PNG（如 /textures/1.12.2/items/diamond_sword.png）。
  // 完整版引擎才有这些资源；精简版缺包则跳过挂载，前端 <img> 404 后回退到图标。无需鉴权（仅公开贴图）。
  try {
    const pvDir = path.dirname(require.resolve("prismarine-viewer/package.json"));
    app.use(
      "/textures",
      express.static(path.join(pvDir, "public", "textures"), { maxAge: "7d", fallthrough: true }),
    );
  } catch {
    /* 精简版无 prismarine-viewer，跳过贴图静态服务 */
  }

  // ===== AI 接口：感知世界状态 + 提交脚本 =====
  app.get("/api/observe/:id", requireToken, (req: Request, res: Response): void => {
    const obs = buildObservation(String(req.params.id));
    if (!obs) {
      res.status(404).json({ error: "bot not found" });
      return;
    }
    res.json(obs);
  });

  // 主动探索：用背包里某个名字的物品打开 GUI，抓取完整内容后关闭，返回结构（AI 可据此搞清服务器定制菜单）。
  // GET /api/explore/:id?item=自助菜单   或不带 item → 列出可探查的菜单候选物品
  app.post("/api/explore/:id", requireToken, async (req: Request, res: Response): Promise<void> => {
    const inst: any = botManager.getInstance(String(req.params.id));
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
      const result = await inst.exploreMenuItem(item, { keep: !!req.body?.keep });
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message ?? e) });
    }
  });

  app.post("/api/ai/script/:id", requireToken, (req: Request, res: Response): void => {
    const id = String(req.params.id);
    const body = req.body || {};
    const script = body.script ?? body;
    if (!script || !script.name || !Array.isArray(script.steps)) {
      res.status(400).json({ error: "invalid script: need { name, steps[] }" });
      return;
    }
    const lib = botManager.loadScripts();
    lib[script.name] = script;
    botManager.saveScripts(lib);
    botManager.eachInstance((inst: any) => inst.preloadScripts && inst.preloadScripts(lib));
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

  const server = http.createServer(app);
  const io = new IOServer(server, { cors: { origin: "*" } });

  // 令牌握手鉴权
  io.use((socket, next) => {
    const auth = socket.handshake.auth as HandshakeAuth;
    if (!auth || auth.token !== token) {
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

  await new Promise<void>((resolve) => {
    server.listen(port, "0.0.0.0", () => resolve());
  });

  botManager.startAll();

  return { app, server, io, port, token };
}
