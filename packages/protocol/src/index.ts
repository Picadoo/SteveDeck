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
  /** 服务器备注/别名，界面优先显示它而非 IP（IP 容易忘） */
  note?: string;
  settings?: BotSettings;
}

/** 持久化的机器人配置（含运行设置） */
export interface BotConfig extends Required<Pick<BotConfigInput, "username" | "host">> {
  id: BotId;
  port: number;
  version: string;
  auth: McAuth;
  loginPassword?: string;
  note?: string;
  settings: BotSettings;
}

/** 机器人运行设置（各模块开关与参数、定时任务、地点等） */
export interface BotSettings {
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
  viewDistance?: "far" | "normal" | "short" | "tiny" | number;
  /** 寻路是否允许破坏方块。默认 false（多数服务器地图受保护，挖不动会卡路径）。 */
  allowDig?: boolean;
  /** 复活后自动执行的指令（如 /back、/spawn），用于多世界 RPG 服回到原处。 */
  respawnCommand?: string;
  combat?: boolean;
  combatConfig?: CombatConfig;
  fishing?: boolean;
  autoMine?: { active: boolean; config?: Record<string, unknown> };
  autoFarm?: Record<string, unknown>;
  mobHunter?: { active: boolean; config?: Record<string, unknown> };
  schedules?: Schedule[];
  savedLocations?: SavedLocation[];
  activeScript?: string | null;
  /** 通用消息监听规则（每服务器可定制的聊天正则统计） */
  monitorRules?: MonitorRule[];
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

/** 通用消息监听：一条正则统计规则 */
export interface MonitorRule {
  id: string;
  label: string;
  enabled: boolean;
  /** 正则（对去色码后的纯文本匹配），含捕获组 */
  pattern: string;
  /** 取第几个捕获组作为「分类键」（如物品名）；设了就按键分组统计（各键各自累计） */
  keyGroup?: number;
  /** 取第几个捕获组作为值（默认 1） */
  valueGroup?: number;
  /** 是否把捕获值解析为数字（支持 万/亿/兆/万亿 + 逗号） */
  numberMode: boolean;
  /** 聚合方式：sum 累加 / count 计次 / last 取最新 / max 峰值 / rate 速率 */
  agg: "sum" | "count" | "last" | "max" | "rate";
}

/** 按分类键细分的一项统计 */
export interface MonitorKeyStat {
  count: number;
  total: number;
  last: number | string | null;
  max: number | null;
}

/** 某条监听规则的实时统计 */
export interface MonitorStat {
  count: number;
  total: number;
  last: number | string | null;
  max: number | null;
  perMin: number;
  /** 按分类键(keyGroup)细分（如各物品名各自的数量）；无 keyGroup 时不含 */
  byKey?: Record<string, MonitorKeyStat>;
}

export interface SavedLocation {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  /** 可选·前往前先执行的指令（多世界切图，如 /warp 主城） */
  command?: string;
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
  trashcleaner?: boolean;
  script?: string | null;
}

export interface InventoryItem {
  slot: number;
  /** 去色码的纯文本名（用于逻辑/搜索） */
  name: string | null;
  /** 原始展示名（保留 §/&颜色码，前端用 McText 渲染） */
  display?: string | null;
  lore?: string;
  count?: number;
  /** 原始物品 id（如 diamond_sword），用于贴图与「能否装备」判断 */
  texture?: string;
  /** 附魔摘要（如 ["锋利 V", "耐久 III"]），RPG 服常见 */
  enchants?: string[];
}

/** 窗口/GUI 中的单个槽位 */
export interface WindowSlot {
  slot: number;
  /** 纯文本名（去 § 颜色码，用于搜索/回退） */
  name: string;
  /** 原始名（含 § 颜色码，供前端彩色渲染） */
  display?: string;
  /** 物品 id（贴图来源） */
  id: string;
  count: number;
  /** Lore（含 § 颜色码，多行 \n） */
  lore?: string;
  enchants?: string[];
}

/** 服务器打开的窗口/GUI（箱子、菜单等） */
export interface WindowState {
  id: number;
  type: string;
  title: string;
  slotCount: number;
  /** 容器部分的槽位数；其后为玩家背包 */
  inventoryStart: number | null;
  slots: (WindowSlot | null)[];
}

/** 列表/看板用的精简状态 */
export interface BotSummary {
  id: BotId;
  username: string;
  host: string;
  /** 游戏版本（如 1.12.2），前端用于拼贴图地址 */
  version?: string;
  /** 服务器备注/别名（界面优先显示） */
  note?: string | null;
  /** 本次在线时长（秒）；离线为 null */
  uptime?: number | null;
  online: boolean;
  health: number | null;
  /** 最大生命（RPG 服可能 >20）。用于把生命显示为百分比 */
  maxHealth?: number | null;
  food: number | null;
  level: number | null;
  /** 机器人到服务器的网络延迟（毫秒）；取不到为 null */
  ping?: number | null;
  pos: Vec3Like | null;
  modules: ModuleFlags;
  reconnecting: boolean;
  fatalReason: string | null;
  savedLocations?: SavedLocation[];
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
  /** 模块数据推送（背包/计分板/统计等） */
  MODULE_DATA: "module:data",
  /** 背包数据（复用引擎事件名） */
  INVENTORY: "player_inv_data",
  /** 服务器打开了窗口/GUI（箱子/菜单） */
  WINDOW_OPEN: "window_open",
  /** 窗口/GUI 已关闭 */
  WINDOW_CLOSE: "window_close",
  /** 窗口/GUI 原地刷新（点击/翻页后服务端更新了槽位，未重开窗口） */
  WINDOW_UPDATE: "window_update",
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
  [ServerEvents.MODULE_STATE]: { id: BotId; module: string; state: unknown };
  [ServerEvents.MODULE_DATA]: { id: BotId; module: string; kind: string; data: unknown };
  [ServerEvents.INVENTORY]: { user: string; items: InventoryItem[] };
  [ServerEvents.WINDOW_OPEN]: { user: string; window: WindowState };
  [ServerEvents.WINDOW_CLOSE]: { user: string };
  [ServerEvents.WINDOW_UPDATE]: { user: string; window: WindowState };
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
  BOT_UPDATE: "bot:update",
  BOT_CONFIG: "bot:config",
  MODULE_TOGGLE: "module:toggle",
  MODULE_CONFIG: "module:config",
  MODULE_ACTION: "module:action",
  SCRIPT_SAVE: "script:save",
  SCRIPT_DELETE: "script:delete",
  SCRIPT_LIST: "script:list",
  SCRIPT_DETAIL: "script:detail",
  SCRIPT_START: "script:start",
  SCRIPT_STOP: "script:stop",
  AI_OBSERVE: "ai:observe",
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
  [ClientCommands.BOT_UPDATE]: { id: BotId; patch: Partial<BotConfigInput> };
  [ClientCommands.BOT_CONFIG]: { id: BotId };
  [ClientCommands.MODULE_TOGGLE]: { id: BotId; module: ModuleName; active: boolean };
  [ClientCommands.MODULE_CONFIG]: { id: BotId; module: ModuleName; config: Record<string, unknown> };
  [ClientCommands.MODULE_ACTION]: { id: BotId; module: string; action: string; args?: Record<string, unknown> };
  [ClientCommands.SCRIPT_SAVE]: { script: BotScript };
  [ClientCommands.SCRIPT_DELETE]: { name: string };
  [ClientCommands.SCRIPT_LIST]: Record<string, never>;
  [ClientCommands.SCRIPT_DETAIL]: { name: string };
  [ClientCommands.SCRIPT_START]: { id: BotId; name: string };
  [ClientCommands.SCRIPT_STOP]: { id: BotId };
  [ClientCommands.AI_OBSERVE]: { id: BotId };
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
  /** 适用服务器(host)；空=通用，所有服务器都显示 */
  server?: string;
  steps: ScriptStep[];
}

export interface ScriptSummary {
  name: string;
  trigger: ScriptTrigger;
  loop: boolean;
  stepCount: number;
  running: boolean;
  /** 适用服务器(host)；空=通用 */
  server?: string;
}

// ==================== AI 感知 ====================

/** 单件装备/手持物的精简描述 */
export interface EquipItem {
  /** 展示名（优先自定义名，已去除颜色码） */
  name: string;
  /** 物品 id，如 diamond_sword */
  id: string;
  count: number;
  /** 附魔摘要，如 ["锋利 V"] */
  enchants?: string[];
}

/** 装备槽位（含双手） */
export interface Equipment {
  mainHand: EquipItem | null;
  offHand: EquipItem | null;
  head: EquipItem | null;
  chest: EquipItem | null;
  legs: EquipItem | null;
  feet: EquipItem | null;
}

export interface Observation {
  bot: { id: BotId; username: string; host: string; online: boolean };
  self: {
    pos: Vec3Like;
    health: number;
    /** 最大生命（RPG 服可能 >20） */
    maxHealth?: number;
    /** 生命百分比 */
    healthPct?: number | null;
    food: number;
    /** 隐藏饱和度缓冲 */
    foodSaturation?: number;
    /** 氧气（仅缺氧时有值，满值为 null） */
    oxygen?: number | null;
    xpLevel: number;
    /** 当前等级进度 % */
    xpProgress?: number;
    /** 网络延迟（毫秒） */
    ping?: number | null;
    heldItem: string | null;
    equipment?: Equipment;
    /** 当前状态效果（药水 buff/debuff） */
    effects?: { name: string; level: number; seconds: number | null; bad: boolean }[];
    /** 视线水平朝向（方位+坐标轴） */
    facing?: string;
    yaw: number;
    pitch: number;
    /** 是否落地 / 在水中 / 正在移动 */
    onGround?: boolean;
    inWater?: boolean;
    moving?: boolean;
    /** 乘坐的载具（如有） */
    vehicle?: string | null;
    dimension: string | null;
    gameMode: string | null;
  } | null;
  inventory: { name: string; count: number; displayName?: string; enchants?: string[] }[];
  /** realPlayer: 真实玩家（在线列表里有）；否则多为玩家型 NPC（Citizens 等）。health/maxHealth 服务器下发才有 */
  nearbyPlayers: {
    name: string;
    display?: string;
    realPlayer?: boolean;
    health?: number | null;
    maxHealth?: number | null;
    distance: number;
    pos: Vec3Like;
  }[];
  /** name 优先为自定义名牌；custom 标记是否有名牌；hostile/category 来自 minecraft-data 分类；health/maxHealth 服务器下发才有 */
  nearbyEntities: {
    type: string;
    name: string;
    custom?: boolean;
    category?: string | null;
    hostile?: boolean;
    health?: number | null;
    maxHealth?: number | null;
    distance: number;
    pos: Vec3Like;
  }[];
  /** 威胁概览：附近敌对生物 */
  threats?: { hostileCount: number; nearest: { name: string; distance: number } | null };
  /** 环境（时间/天气） */
  environment?: { timeOfDay: string; isDay: boolean; raining: boolean; thundering: boolean };
  /** 一句话情景摘要（供 AI 快速读取） */
  summary?: string;
  /** 服务器聊天 */
  recentChat: string[];
  /** 机器人操作日志（动作/模块/脚本） */
  recentOps: string[];
  modules: Record<string, unknown>;
  savedLocations: SavedLocation[];
  scoreboard?: unknown;
  /** 服务器渲染到客户端可见处的文本（PAPI 常输出于此） */
  serverText?: {
    world: string | null;
    tablistHeader: string | null;
    tablistFooter: string | null;
    bossBars: { title: string | null; progress: number | null }[];
  };
  /** 玩家 Tab 展示名（含 PAPI 前后缀） */
  playersDisplay?: { name: string; display: string }[];
}

// ==================== Socket.IO 握手鉴权 ====================

export interface HandshakeAuth {
  token: string;
}

/** 默认引擎监听端口 */
export const DEFAULT_ENGINE_PORT = 8723;
