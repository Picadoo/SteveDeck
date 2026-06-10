import { Server as IOServer, Socket } from "socket.io";
import { ClientCommands, ServerEvents, BotConfigInput, BotConfigResponse } from "@mcbot/protocol";
import { botManager } from "../botManager";
import { Ack, ok, fail } from "./ack";
import { registerModuleHandlers } from "./moduleHandlers";
import { registerScriptHandlers } from "./scriptHandlers";
import { buildObservation } from "../ai/observe";

const { isChatBlocked } = require("../utils/chatSafety");

function broadcastSnapshot(io: IOServer): void {
  io.emit(ServerEvents.BOTS_SNAPSHOT, { bots: botManager.buildSnapshot() });
}

/**
 * 注册客户端命令处理器。
 * 核心命令（增删/重连/停止/聊天/寻路）在此；各功能模块命令在 moduleHandlers。
 */
export function registerHandlers(io: IOServer, socket: Socket): void {
  socket.emit(ServerEvents.BOTS_SNAPSHOT, { bots: botManager.buildSnapshot() });

  // 背包首帧快照：背包推送带变更检测（内容不变不广播），新连接的前端不补这一帧会一直空着。
  // force=true 绕过去重；广播面向全部客户端，老客户端收到等同幂等刷新（仅连接时一次）。
  for (const cfg of botManager.getConfigs()) {
    try {
      (botManager.getInstance(cfg.id) as any)?.syncInventory?.(true);
    } catch { /* ignore */ }
  }

  socket.on(ClientCommands.BOT_ADD, (input: BotConfigInput, ack?: Ack) => {
    try {
      const cfg = botManager.addBot(input);
      broadcastSnapshot(io);
      ack?.(ok({ id: cfg.id }));
    } catch (e: any) {
      ack?.(fail(String(e?.message ?? e)));
    }
  });

  socket.on(ClientCommands.BOT_DELETE, ({ id }: { id: string }, ack?: Ack) => {
    const done = botManager.deleteBot(id);
    if (done) broadcastSnapshot(io);
    ack?.(done ? ok() : fail("机器人不存在"));
  });

  socket.on(ClientCommands.BOT_RECONNECT, ({ id }: { id: string }, ack?: Ack) => {
    botManager.reconnect(id);
    ack?.(ok());
  });

  socket.on(ClientCommands.BOT_STOP, ({ id }: { id: string }, ack?: Ack) => {
    botManager.stop(id);
    ack?.(ok());
  });

  socket.on(
    ClientCommands.BOT_CHAT,
    ({ id, message }: { id: string; message: string }, ack?: Ack) => {
      const inst = botManager.getInstance(id);
      if (!inst?.bot) return ack?.(fail("机器人不在线"));
      if (isChatBlocked(message)) return ack?.(fail("该命令已被安全策略禁止发送"));
      try {
        inst.bot.chat(message);
        (inst as any).recorder?.note?.("chat", { message });
        ack?.(ok());
      } catch (e: any) {
        ack?.(fail(String(e?.message ?? e)));
      }
    },
  );

  socket.on(
    ClientCommands.BOT_GOTO,
    ({ id, x, y, z }: { id: string; x: number; y: number; z: number }, ack?: Ack) => {
      const inst = botManager.getInstance(id);
      if (!inst) return ack?.(fail("机器人不存在"));
      const nx = Number(x), ny = Number(y), nz = Number(z);
      if (![nx, ny, nz].every(Number.isFinite)) return ack?.(fail("坐标无效")); // API-11：挡 NaN 入寻路
      try {
        (inst as any).recorder?.note?.("goto", { x: nx, y: ny, z: nz });
        inst.move(nx, ny, nz);
        ack?.(ok());
      } catch (e: any) {
        ack?.(fail(String(e?.message ?? e)));
      }
    },
  );

  socket.on(ClientCommands.BOT_UPDATE, ({ id, patch }: { id: string; patch: any }, ack?: Ack) => {
    try {
      const done = botManager.updateBot(id, patch || {});
      if (done) broadcastSnapshot(io);
      ack?.(done ? ok() : fail("机器人不存在"));
    } catch (e: any) {
      ack?.(fail(String(e?.message ?? e))); // API-6：校验失败（端口/长度）回 ack，不抛崩进程
    }
  });

  socket.on(ClientCommands.BOT_CONFIG, ({ id }: { id: string }, ack?: Ack) => {
    const cfg = botManager.getConfig(id);
    if (!cfg) return ack?.(fail("机器人不存在"));
    // API-10：不回传明文 loginPassword（开源后明文出网属泄露）。
    // 只回布尔 hasLoginPassword，前端据此决定密码框占位文案；密码留在引擎存储层，编辑时留空＝不修改。
    const resp: BotConfigResponse = {
      username: cfg.username,
      host: cfg.host,
      port: cfg.port,
      version: cfg.version,
      auth: cfg.auth,
      loginCommand: cfg.loginCommand,
      hasLoginPassword: !!cfg.loginPassword,
      note: cfg.note,
      settings: cfg.settings,
    };
    ack?.(ok(resp));
  });

  socket.on(ClientCommands.AI_OBSERVE, ({ id }: { id: string }, ack?: Ack) => {
    const obs = buildObservation(id);
    ack?.(obs ? ok(obs) : fail("机器人不存在"));
  });

  // ===== 配置导入导出（备份 / 迁移 / 分享） =====
  socket.on(ClientCommands.DATA_EXPORT, (_payload: unknown, ack?: Ack) => {
    ack?.(ok(botManager.exportData()));
  });

  socket.on(ClientCommands.DATA_IMPORT, ({ bundle }: { bundle: any }, ack?: Ack) => {
    try {
      if (!bundle || typeof bundle !== "object" || !Array.isArray(bundle.bots)) {
        return ack?.(fail("无效的备份文件（缺 bots 数组）"));
      }
      if (bundle.schemaVersion !== 1) {
        return ack?.(fail(`不支持的备份版本: ${bundle.schemaVersion ?? "未知"}`));
      }
      const res = botManager.importData(bundle);
      broadcastSnapshot(io);
      ack?.(ok(res));
    } catch (e: any) {
      ack?.(fail(String(e?.message ?? e)));
    }
  });

  registerModuleHandlers(io, socket);
  registerScriptHandlers(socket);
}
