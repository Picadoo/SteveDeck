import { Server as IOServer, Socket } from "socket.io";
import { ClientCommands, ServerEvents, BotConfigInput } from "@mcbot/protocol";
import { botManager } from "../botManager";
import { Ack, ok, fail } from "./ack";
import { registerModuleHandlers } from "./moduleHandlers";

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
      try {
        inst.move(x, y, z);
        ack?.(ok());
      } catch (e: any) {
        ack?.(fail(String(e?.message ?? e)));
      }
    },
  );

  registerModuleHandlers(io, socket);
}
