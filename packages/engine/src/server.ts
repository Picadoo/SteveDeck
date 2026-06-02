import http from "http";
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

/**
 * 启动引擎 HTTP + WebSocket 服务。
 * Phase 0：仅令牌鉴权 + /health + /api/connection-info + Socket.IO 握手。
 * Phase 1 起：在 io.on('connection') 内注册机器人命令处理器。
 */
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

  const server = http.createServer(app);
  const io = new IOServer(server, { cors: { origin: "*" } });

  io.use((socket, next) => {
    const auth = socket.handshake.auth as HandshakeAuth;
    if (!auth || auth.token !== token) {
      next(new Error("unauthorized"));
      return;
    }
    next();
  });

  io.on("connection", (socket) => {
    socket.emit(ServerEvents.ENGINE_INFO, {
      version: ENGINE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
    });
    // Phase 1 起：registerCommandHandlers(io, socket, botManager)
  });

  await new Promise<void>((resolve) => {
    server.listen(port, "0.0.0.0", () => resolve());
  });

  return { app, server, io, port, token };
}
