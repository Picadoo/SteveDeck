import { randomUUID } from "crypto";
import { Server as IOServer } from "socket.io";
import {
  BotConfig,
  BotConfigInput,
  BotSummary,
  ServerEvents,
} from "@mcbot/protocol";
import {
  loadBots,
  saveBots,
  loadScripts as loadScriptsFile,
  saveScripts as saveScriptsFile,
  loadCustomScripts as loadCustomScriptsFile,
  saveCustomScripts as saveCustomScriptsFile,
} from "./storage";

// 复用的核心逻辑（CommonJS JS 模块）
const BotInstance = require("./BotInstance");
const logger = require("./utils/logger");

/** 广播链：兼容被复用模块的 io.to(room).to(room).emit() 调用形态。
 *  单主人模型下「所有已认证客户端」即目标，故忽略 room 一律广播。 */
interface EmitChain {
  to(room?: string): EmitChain;
  emit(event: string, payload: unknown): void;
}

class BotManager {
  private io!: IOServer;
  private broadcaster!: EmitChain;
  private bots = new Map<string, any>(); // id -> BotInstance
  private configs: BotConfig[] = [];
  private recentChat = new Map<string, string[]>(); // id -> 服务器聊天
  private recentOps = new Map<string, string[]>(); // id -> 机器人操作日志

  private pushLine(map: Map<string, string[]>, id: string, text?: string): void {
    if (!id || !text) return;
    const arr = map.get(id) ?? [];
    arr.push(text);
    while (arr.length > 40) arr.shift();
    map.set(id, arr);
  }
  getRecentChat(id: string): string[] {
    return this.recentChat.get(id) ?? [];
  }
  getRecentOps(id: string): string[] {
    return this.recentOps.get(id) ?? [];
  }
  private dropLogs(id: string): void {
    this.recentChat.delete(id);
    this.recentOps.delete(id);
  }
  getConfig(id: string): BotConfig | undefined {
    return this.configs.find((c) => c.id === id);
  }

  init(io: IOServer): void {
    this.io = io;
    this.broadcaster = this.makeBroadcaster();
    this.configs = loadBots();
    logger.info(`[BotManager] 已加载 ${this.configs.length} 个机器人配置`);
  }

  // ============ 广播 + 事件翻译 ============
  private makeBroadcaster(): EmitChain {
    const self = this;
    const chain: EmitChain = {
      to: () => chain,
      emit(event: string, payload: any) {
        const t = self.translate(event, payload);
        if (t) self.io.emit(t.event, t.payload);
        else self.io.emit(event, payload); // 模块专属事件原样透传（Phase 4 UI 消费）
      },
    };
    return chain;
  }

  /** 把复用代码的旧事件名翻译成新协议事件（带 botId）。 */
  private translate(event: string, payload: any): { event: string; payload: unknown } | null {
    if (event === "status") {
      const cfg = this.findByUsername(payload?.user);
      if (!cfg) return null;
      return { event: ServerEvents.BOT_STATUS, payload: { bot: this.buildSummary(cfg) } };
    }
    if (event === "log") {
      const cfg = this.findByUsername(payload?.user);
      const isChat = !!payload?.chat;
      if (cfg) this.pushLine(isChat ? this.recentChat : this.recentOps, cfg.id, payload?.msg);
      return {
        event: ServerEvents.BOT_LOG,
        payload: {
          id: cfg?.id ?? null,
          line: { time: payload?.time, text: payload?.msg, level: isChat ? "chat" : "info" },
        },
      };
    }
    if (event === "bot_error") {
      const cfg = this.findByUsername(payload?.user);
      return { event: ServerEvents.BOT_ERROR, payload: { id: cfg?.id ?? null, error: payload?.error } };
    }
    return null;
  }

  // ============ 查询 ============
  getConfigs(): BotConfig[] {
    return this.configs;
  }
  getInstance(id: string): any | undefined {
    return this.bots.get(id);
  }
  private findByUsername(username?: string): BotConfig | undefined {
    if (!username) return undefined;
    return this.configs.find((c) => c.username === username);
  }

  buildSnapshot(): BotSummary[] {
    return this.configs.map((c) => this.buildSummary(c));
  }

  /** 读取最大生命属性（RPG 服常把它调高到 >20）。取不到则回退 20。 */
  private maxHealthOf(bot: any): number {
    try {
      const a = bot?.entity?.attributes;
      if (a) {
        const e =
          a["minecraft:generic.max_health"] || a["generic.maxHealth"] || a["generic.max_health"];
        const v = e?.value;
        if (typeof v === "number" && v > 0) return Math.round(v);
      }
    } catch {
      /* ignore */
    }
    return 20;
  }

  buildSummary(cfg: BotConfig): BotSummary {
    const inst = this.bots.get(cfg.id);
    const bot = inst?.bot;
    const online = !!(bot && bot.entity);
    return {
      id: cfg.id,
      username: cfg.username,
      host: cfg.host,
      version: cfg.version,
      note: cfg.note ?? null,
      uptime: online ? Math.floor((Date.now() - (inst.spawnedAt || Date.now())) / 1000) : null,
      online,
      health: online ? Math.round(bot.health) : null,
      maxHealth: online ? this.maxHealthOf(bot) : null,
      food: online ? Math.round(bot.food) : null,
      level: online ? (bot.experience ? bot.experience.level : 0) : null,
      ping: online && typeof bot.player?.ping === "number" ? bot.player.ping : null,
      pos: online
        ? {
            x: Math.floor(bot.entity.position.x),
            y: Math.floor(bot.entity.position.y),
            z: Math.floor(bot.entity.position.z),
          }
        : null,
      modules: inst
        ? {
            combat: !!(inst.combatConfig && inst.combatConfig.enabled),
            fishing: !!inst.fishingActive,
            automine: !!(inst.autoMineTask && inst.autoMineTask.active),
            autofarm: !!(inst.farmTask && inst.farmTask.active),
            mobhunter: !!(inst.mobHunterTask && inst.mobHunterTask.active),
            trashcleaner: !!(inst.trashCleanerTask && inst.trashCleanerTask.active),
            script:
              (inst._runningScript && inst._runningScript.name) ||
              (inst._customJs && `JS:${inst._customJs.name}`) ||
              null,
          }
        : {},
      reconnecting: inst ? inst.reconnectAttempts > 0 && !online : false,
      fatalReason: (inst && inst._fatalReason) || null,
      savedLocations: (inst && inst.savedLocations) || cfg.settings?.savedLocations || [],
    };
  }

  // ============ 生命周期 ============
  /** BotInstance 期望的 config 形态（username/host/version/password/settings）。 */
  private toInstanceConfig(cfg: BotConfig): any {
    return {
      id: cfg.id,
      username: cfg.username,
      host: cfg.host,
      port: cfg.port,
      version: cfg.version,
      password: cfg.loginPassword,
      settings: cfg.settings,
      ownerId: undefined,
    };
  }

  private persist(): void {
    saveBots(this.configs);
  }

  /** 供 API 层在修改 settings 后落盘。 */
  save(): void {
    this.persist();
  }

  // ============ 脚本库 ============
  loadScripts(): Record<string, any> {
    return loadScriptsFile() as Record<string, any>;
  }
  saveScripts(scripts: Record<string, any>): void {
    saveScriptsFile(scripts);
  }
  loadCustomScripts(): Record<string, any> {
    return loadCustomScriptsFile() as Record<string, any>;
  }
  saveCustomScripts(scripts: Record<string, any>): void {
    saveCustomScriptsFile(scripts);
  }
  /** 遍历所有在线实例（用于同步脚本库等）。 */
  eachInstance(fn: (inst: any) => void): void {
    for (const inst of this.bots.values()) {
      try {
        fn(inst);
      } catch {
        /* 单个实例失败不影响其他 */
      }
    }
  }

  addBot(input: BotConfigInput): BotConfig {
    if (!input?.username || !input?.host) throw new Error("用户名和服务器地址必填");
    const dup = this.configs.find((c) => c.username === input.username && c.host === input.host);
    if (dup) throw new Error(`机器人 ${input.username}@${input.host} 已存在`);

    const cfg: BotConfig = {
      id: randomUUID(),
      username: input.username,
      host: input.host,
      port: input.port ?? 25565,
      version: input.version ?? "1.20.1",
      auth: input.auth ?? "offline",
      loginPassword: input.loginPassword,
      note: input.note,
      settings: input.settings ?? { combat: false, fishing: false, reconnectDelay: 5, schedules: [] },
    };
    this.configs.push(cfg);
    this.persist();
    this.spawn(cfg);
    return cfg;
  }

  deleteBot(id: string): boolean {
    const inst = this.bots.get(id);
    if (inst) {
      try {
        inst.stop();
      } catch (e: any) {
        logger.error(`[BotManager] 停止失败:`, e?.message);
      }
      this.bots.delete(id);
    }
    const before = this.configs.length;
    this.configs = this.configs.filter((c) => c.id !== id);
    if (this.configs.length === before) return false;
    this.persist();
    this.io.emit(ServerEvents.BOT_DELETED, { id });
    return true;
  }

  updateBot(id: string, patch: Partial<BotConfigInput>): boolean {
    const cfg = this.configs.find((c) => c.id === id);
    if (!cfg) return false;
    let reconnect = false;
    const chg = <K extends keyof BotConfig>(k: K, v: BotConfig[K]) => {
      if (v !== undefined && v !== cfg[k]) {
        cfg[k] = v;
        reconnect = true;
      }
    };
    chg("username", patch.username as any);
    chg("host", patch.host as any);
    chg("port", patch.port as any);
    chg("version", patch.version as any);
    chg("loginPassword", patch.loginPassword as any);
    // 备注是纯展示字段，改它不必重连
    if (patch.note !== undefined) cfg.note = patch.note;
    this.persist();
    // 仅在连接参数变化时重建实例
    const had = this.bots.get(id);
    if (had && reconnect) {
      try {
        had.stop();
      } catch {
        /* ignore */
      }
      this.bots.delete(id);
      this.dropLogs(id);
      this.spawn(cfg);
    }
    return true;
  }

  reconnect(id: string): void {
    const inst = this.bots.get(id);
    if (inst?.reconnect) inst.reconnect();
  }

  stop(id: string): void {
    const inst = this.bots.get(id);
    if (inst?.stop) inst.stop();
  }

  private spawn(cfg: BotConfig): void {
    if (this.bots.has(cfg.id)) return;
    try {
      const inst = new BotInstance(this.toInstanceConfig(cfg), this.broadcaster, () => this.persist());
      this.bots.set(cfg.id, inst);
      logger.info(`[BotManager] ${cfg.username}@${cfg.host} 已创建`);
    } catch (e: any) {
      logger.error(`[BotManager] 创建失败:`, e?.message);
    }
  }

  /** 启动时按 host 轻度错峰登录，避免同服瞬间大量登录。 */
  startAll(): void {
    const perHostCount: Record<string, number> = {};
    for (const cfg of this.configs) {
      const n = perHostCount[cfg.host] ?? 0;
      perHostCount[cfg.host] = n + 1;
      const delay = n * 1500;
      setTimeout(() => {
        if (!this.bots.has(cfg.id)) this.spawn(cfg);
      }, delay);
    }
  }
}

export const botManager = new BotManager();
export type { BotManager };
