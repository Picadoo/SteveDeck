/**
 * @mcbot/protocol
 * 客户端（Tauri 桌面/安卓）与引擎（Node）之间的通信契约。
 * 单一事实源：事件名、命令、负载与状态结构都定义在此，两端共同 import。
 */

export const PROTOCOL_VERSION = 1;

// ==================== 基础类型 ====================

export type BotId = string;

/** 机器人正版/离线登录方式 */
export type McAuth = "offline" | "microsoft";

/** 已支持的功能模块标识 */
export type ModuleName =
  | "combat"
  | "fishing"
  | "automine"
  | "auto_farm"
  | "mob_hunter"
  | "trash_cleaner"
  | "scheduler";

/** 创建机器人时的输入 */
export interface BotConfigInput {
  /** 机器人登录 MC 用的用户名（同时作为展示标识） */
  username: string;
  host: string;
  port?: number;
  version?: string;
  auth?: McAuth;
  /** 登录服需要的 /login 密码（可选） */
  loginPassword?: string;
  settings?: BotSettings;
}

/** 持久化的机器人配置（含运行设置） */
export interface BotConfig extends Required<Pick<BotConfigInput, "username" | "host">> {
  id: BotId;
  port: number;
  version: string;
  auth: McAuth;
  loginPassword?: string;
  settings: BotSettings;
}

/** 机器人运行设置（各模块开关与参数、定时任务、地点等） */
export interface BotSettings {
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
  viewDistance?: "far" | "normal" | "short" | "tiny" | number;
  combat?: boolean;
  combatConfig?: CombatConfig;
  fishing?: boolean;
  autoMine?: { active: boolean; config?: Record<string, unknown> };
  autoFarm?: Record<string, unknown>;
  mobHunter?: { active: boolean; config?: Record<string, unknown> };
  schedules?: Schedule[];
  savedLocations?: SavedLocation[];
  activeScript?: string | null;
  [key: string]: unknown;
}

export interface CombatConfig {
  enabled: boolean;
  range: number;
  maxTargets: number;
  antiKb: boolean;
  attackPlayers: boolean;
  attackMobs: boolean;
}

export interface Schedule {
  time: string; // "HH:MM"
  command: string;
}

export interface SavedLocation {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  createdAt: number;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

// ==================== 状态与日志 ====================

export interface ModuleFlags {
  combat?: boolean;
  fishing?: boolean;
  automine?: boolean;
  autofarm?: boolean;
  mobhunter?: boolean;
  script?: string | null;
}

/** 列表/看板用的精简状态 */
export interface BotSummary {
  id: BotId;
  username: string;
  host: string;
  online: boolean;
  health: number | null;
  food: number | null;
  level: number | null;
  pos: Vec3Like | null;
  modules: ModuleFlags;
  reconnecting: boolean;
  fatalReason: string | null;
}

/** 详情用的完整状态 */
export interface BotStatus extends BotSummary {
  combatConfig?: CombatConfig;
  savedLocations?: SavedLocation[];
  schedules?: Schedule[];
}

export interface LogLine {
  time: string;
  text: string;
  level?: "info" | "warn" | "error" | "chat";
}

export interface ConnectionInfo {
  engineVersion: string;
  protocolVersion: number;
  /** 可达地址候选（含内网/回环） */
  addresses: string[];
  port: number;
  /** mcbot://host:port?token=... */
  connectionString: string;
  /** 二维码 dataURL（image/png base64），供移动端扫码 */
  qrcodeDataUrl?: string;
}

// ==================== 服务端 → 客户端 事件 ====================

export const ServerEvents = {
  /** 连接成功后下发的引擎信息 */
  ENGINE_INFO: "engine:info",
  /** 全量机器人快照 */
  BOTS_SNAPSHOT: "bots:snapshot",
  /** 单机器人状态（增量） */
  BOT_STATUS: "bot:status",
  /** 机器人被删除 */
  BOT_DELETED: "bot:deleted",
  /** 日志流 */
  BOT_LOG: "bot:log",
  /** 模块状态变更 */
  MODULE_STATE: "module:state",
  /** 机器人错误（致命断开等） */
  BOT_ERROR: "bot:error",
  /** 脚本列表 */
  SCRIPT_LIST: "script:list",
  /** 脚本详情 */
  SCRIPT_DETAIL: "script:detail",
} as const;

export interface ServerToClientPayloads {
  [ServerEvents.ENGINE_INFO]: { version: string; protocolVersion: number };
  [ServerEvents.BOTS_SNAPSHOT]: { bots: BotSummary[] };
  [ServerEvents.BOT_STATUS]: { bot: BotStatus };
  [ServerEvents.BOT_DELETED]: { id: BotId };
  [ServerEvents.BOT_LOG]: { id: BotId; line: LogLine };
  [ServerEvents.MODULE_STATE]: { id: BotId; module: ModuleName; state: unknown };
  [ServerEvents.BOT_ERROR]: { id: BotId; error: string };
  [ServerEvents.SCRIPT_LIST]: { scripts: ScriptSummary[] };
  [ServerEvents.SCRIPT_DETAIL]: { name: string; script: BotScript | null };
}

// ==================== 客户端 → 服务端 命令 ====================

export const ClientCommands = {
  BOT_ADD: "bot:add",
  BOT_DELETE: "bot:delete",
  BOT_RECONNECT: "bot:reconnect",
  BOT_STOP: "bot:stop",
  BOT_CHAT: "bot:chat",
  BOT_GOTO: "bot:goto",
  MODULE_TOGGLE: "module:toggle",
  MODULE_CONFIG: "module:config",
  SCRIPT_SAVE: "script:save",
  SCRIPT_DELETE: "script:delete",
  SCRIPT_LIST: "script:list",
  SCRIPT_DETAIL: "script:detail",
  SCRIPT_START: "script:start",
  SCRIPT_STOP: "script:stop",
  LOCATION_SAVE: "location:save",
  LOCATION_DELETE: "location:delete",
  LOCATION_GOTO: "location:goto",
} as const;

export interface ClientToServerPayloads {
  [ClientCommands.BOT_ADD]: BotConfigInput;
  [ClientCommands.BOT_DELETE]: { id: BotId };
  [ClientCommands.BOT_RECONNECT]: { id: BotId };
  [ClientCommands.BOT_STOP]: { id: BotId };
  [ClientCommands.BOT_CHAT]: { id: BotId; message: string };
  [ClientCommands.BOT_GOTO]: { id: BotId; x: number; y: number; z: number };
  [ClientCommands.MODULE_TOGGLE]: { id: BotId; module: ModuleName; active: boolean };
  [ClientCommands.MODULE_CONFIG]: { id: BotId; module: ModuleName; config: Record<string, unknown> };
  [ClientCommands.SCRIPT_SAVE]: { script: BotScript };
  [ClientCommands.SCRIPT_DELETE]: { name: string };
  [ClientCommands.SCRIPT_LIST]: Record<string, never>;
  [ClientCommands.SCRIPT_DETAIL]: { name: string };
  [ClientCommands.SCRIPT_START]: { id: BotId; name: string };
  [ClientCommands.SCRIPT_STOP]: { id: BotId };
  [ClientCommands.LOCATION_SAVE]: { id: BotId; name: string };
  [ClientCommands.LOCATION_DELETE]: { id: BotId; locationId: string };
  [ClientCommands.LOCATION_GOTO]: { id: BotId; locationId: string };
}

/** 命令统一 ack 回执 */
export interface CommandAck<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}

// ==================== 脚本（可视化脚本引擎） ====================

export interface ScriptStep {
  do: string;
  [key: string]: unknown;
}

export interface ScriptTrigger {
  type:
    | "manual"
    | "schedule"
    | "chat_match"
    | "health_below"
    | "respawn"
    | "player_nearby"
    | "inventory_full"
    | "interval";
  value?: string | number;
}

export interface BotScript {
  name: string;
  loop?: boolean;
  loopDelay?: number;
  trigger?: ScriptTrigger;
  steps: ScriptStep[];
}

export interface ScriptSummary {
  name: string;
  trigger: ScriptTrigger;
  loop: boolean;
  stepCount: number;
  running: boolean;
}

// ==================== Socket.IO 握手鉴权 ====================

export interface HandshakeAuth {
  token: string;
}

/** 默认引擎监听端口 */
export const DEFAULT_ENGINE_PORT = 8723;
