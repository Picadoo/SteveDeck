import { Server as IOServer, Socket } from "socket.io";
import {
  ClientCommands,
  ServerEvents,
  CommandAck,
  BotConfigInput,
} from "@mcbot/protocol";
import { botManager } from "../botManager";

const { isChatBlocked } = require("../utils/chatSafety");

type Ack = (res: CommandAck) => void;

function ok<T>(data?: T): CommandAck<T> {
  return { ok: true, data };
}
function fail(error: string): CommandAck {
  return { ok: false, error };
}
function broadcastSnapshot(io: IOServer): void {
  io.emit(ServerEvents.BOTS_SNAPSHOT, { bots: botManager.buildSnapshot() });
}

/**
 * 注册客户端命令处理器。
 * Phase 1：核心命令（增删/重连/停止/聊天/寻路/战斗·钓鱼开关与配置）。
 * Phase 4：扩展挖矿/农场/追怪/背包/GUI/定时/计分板/脚本等模块命令。
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

  socket.on(
    ClientCommands.MODULE_TOGGLE,
    ({ id, module, active }: { id: string; module: string; active: boolean }, ack?: Ack) => {
      const inst = botManager.getInstance(id);
      if (!inst) return ack?.(fail("机器人不存在"));
      try {
        if (module === "combat") {
          inst.combatConfig.enabled = active;
        } else if (module === "fishing") {
          if (typeof inst.setFishing === "function") inst.setFishing(active);
          else inst.fishingActive = active;
        } else {
          return ack?.(fail(`模块 ${module} 将在后续阶段接入`));
        }
        const cfg = botManager.getConfigs().find((c) => c.id === id);
        if (cfg) {
          cfg.settings = cfg.settings || {};
          (cfg.settings as any)[module] = active;
          botManager.save();
        }
        io.emit(ServerEvents.MODULE_STATE, { id, module, state: { active } });
        ack?.(ok());
      } catch (e: any) {
        ack?.(fail(String(e?.message ?? e)));
      }
    },
  );

  socket.on(
    ClientCommands.MODULE_CONFIG,
    ({ id, module, config }: { id: string; module: string; config: Record<string, unknown> }, ack?: Ack) => {
      const inst = botManager.getInstance(id);
      if (!inst) return ack?.(fail("机器人不存在"));
      try {
        if (module === "combat") {
          inst.combatConfig = { ...inst.combatConfig, ...config };
          const cfg = botManager.getConfigs().find((c) => c.id === id);
          if (cfg) {
            cfg.settings = cfg.settings || {};
            (cfg.settings as any).combatConfig = inst.combatConfig;
            botManager.save();
          }
        }
        io.emit(ServerEvents.MODULE_STATE, { id, module, state: config });
        ack?.(ok());
      } catch (e: any) {
        ack?.(fail(String(e?.message ?? e)));
      }
    },
  );
}
