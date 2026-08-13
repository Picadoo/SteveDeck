// BotInstance 的类型契约（手写 .d.ts 式接口）。
//
// 背景：BotInstance 本体与全部功能模块是无类型 JS，方法靠模块在 spawn 后运行时挂载
// （require('./modules/x')(this)），没有编译期契约。TS 层（API/server/AI）此前全用
// `inst: any` + 可选链盲调——方法名拼错编译期零报错，运行时静默变 `undefined?.()` 什么都不发生。
//
// 这个接口就是那份契约：**方法名与字段名是强校验的**（TS 层引用不存在的名字会直接编译失败），
// 参数/返回值按需从宽（大多 any），后续可逐个收紧。禁止加索引签名（[k: string]: any）——
// 加了等于回到盲调时代。
//
// 维护规则：模块新挂载一个方法且 TS 层要调用时，在对应分组加一行；名字必须与 JS 侧一致
// （改名时 typecheck 会把所有调用点揪出来，这正是要的效果）。

/** 模块任务通用形态（automine/farm/mobhunter/follow/trashcleaner 等的运行态） */
export interface ModuleTask {
  active?: boolean;
  config?: any;
  [extra: string]: any; // 各模块自有统计字段（kills/harvested 等），形状由模块自定义
}

export interface BotInstance {
  // ===== 核心字段（构造函数/生命周期建立） =====
  bot: any | null; // mineflayer Bot（无官方精确类型可用时保持 any）
  config: {
    id: string;
    username: string;
    host: string;
    port?: number;
    version?: string;
    auth?: string;
    password?: string;
    loginCommand?: string;
    settings?: any;
    ownerId?: string;
  };
  io: any; // 广播链（botManager.makeBroadcaster 的 EmitChain）
  spawnedAt?: number;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  isExplicitlyQuitting: boolean;
  destroyed: boolean;
  timers: ReturnType<typeof setTimeout>[];
  cleanupHooks: Array<() => void>;
  savedLocations: any[];
  recorder: {
    active?: boolean;
    start(): { active: boolean; count: number };
    stop(): { steps: any[]; count: number };
    status(): { active: boolean; count: number; last: any };
    note(kind: string, data?: Record<string, unknown>): void;
    mark?: (...args: any[]) => any;
  };
  _fatalReason?: string | null;
  _actionBar?: { text: string; at: number } | null;

  // ===== 生命周期 / 连接 =====
  init(): Promise<void> | void;
  stop(): void;
  reconnect(): void;
  cleanup(): void;
  uiLog(msg: string): void;
  notifyEvent(kind: "death" | "kick" | "offline" | "online", message: string): void;
  hasWatchers(): boolean;
  pushOneShot(fn: () => void, delayMs: number): void;
  saveConfig?: () => void;
  restoreModules(settings?: any): void;

  // ===== 移动 / 寻路 =====
  move(x: number, y: number, z: number, range?: number): any;
  makeMovements(): any;
  applyMovements(): void;
  stopAllActions(): { stopped: string[] } | any;
  rawMoveEnabled: boolean;
  setRawControl(states: Record<string, boolean>): void;
  stopRawMove(): void;

  // ===== 地点 =====
  saveLocation(name: string, command?: string, steps?: any[]): any;
  deleteLocation(id: string): { success?: boolean; error?: string } | any;
  goToLocation(id: string): Promise<any> | any;
  setLocationReach(id: string, patch: { command?: string; steps?: any[] }): any;

  // ===== 背包 / GUI 窗口（player_inventory / window_gui / interact 模块挂载） =====
  syncInventory(force?: boolean): void;
  getWindow(): any;
  clickWindowSlot(slot: number, button?: number, mode?: number): Promise<any> | any;
  closeGui(): boolean | void;
  openContainerAt(x: number, y: number, z: number): Promise<any> | any;
  exploreMenuItem(item: string, opts?: { keep?: boolean; clickPath?: string[] }): Promise<any>;
  listMenuCandidates(): any[];
  scanContainers(): any;
  scanNearbyNPCs(): any;
  interactWithNPC(idOrName: string | number): Promise<any> | any;
  readBookSlot(...args: any[]): Promise<any> | any;
  writeBookSlot(slot: number, pages: string[], sign?: boolean): Promise<any>;
  holdSlot(slot: number): Promise<any> | any;
  useSlot(slot: number, opts?: { sneak?: boolean }): Promise<any>;
  equipSlot(slot: number, dest?: string): Promise<any> | any;
  offhandSlot(slot: number): Promise<any> | any;
  dropSlot(slot: number, all?: boolean): Promise<any> | any;
  moveSlot(from: number, to: number): Promise<any> | any;

  // ===== 功能模块：开关 + 运行态 + 统计 =====
  combatConfig: any; // 形状=protocol CombatConfig，但 JS 侧可能带临时键，保持 any 免得两头互卡
  fishingActive?: boolean;
  setFishing(on: boolean): void;
  autoMineTask?: ModuleTask | null;
  toggleAutoMine(on: boolean, config?: any): any;
  stopAutoMine?: () => void;
  getMineStats(): any;
  /** 轻量模块的运行统计（模块页展示「在干什么」）：spawn 后由各模块挂载 */
  getCombatStats?: () => any;
  getFishingStats?: () => any;
  getFollowStats?: () => any;
  getTrashStats?: () => any;
  setMineAreaSel1(): any;
  setMineAreaSel2(): any;
  clearMineArea(): any;
  farmTask?: ModuleTask | null;
  toggleAutoFarm(on: boolean, config?: any): any;
  scanFarmland(): void;
  getFarmStats(): any;
  mobHunterTask?: ModuleTask | null;
  toggleMobHunter(on: boolean, config?: any): any;
  getMobHunterStats(): any;
  setHuntSel1(): any;
  setHuntSel2(): any;
  setHuntAreaBox(...coords: number[]): any;
  setHuntAreaCircle(radius?: number): any;
  clearHuntArea(): any;
  returnToHuntArea(): any;
  followTask?: ModuleTask | null;
  toggleFollow(on: boolean, config?: any): any;
  trashCleanerTask?: ModuleTask | null;
  toggleTrashCleaner(on: boolean, items?: string[]): any;
  autoUseTask?: ModuleTask | null;
  toggleAutoUse(on: boolean, config?: any): any;

  // ===== 计分板 / 消息监听 =====
  getScoreboard(): any;
  getScoreboardValue?: (pattern: string) => any;
  getMonitor(): { rules: any[]; stats: Record<string, any> };
  setMonitorRules(rules: any[]): any;
  resetMonitorStats(): void;
  testMonitorRule(...args: any[]): any;

  // ===== 积木脚本引擎（script_engine 模块挂载） =====
  _runningScript?: { name: string; [k: string]: any } | null;
  _scripts?: Record<string, any>;
  preloadScripts(lib: Record<string, any>): void;
  listScripts(): any[];
  getScriptDetail?: (name: string) => any;
  saveScript(script: any, overwrite?: boolean): any;
  deleteScript(name: string): boolean;
  startScript(name: string): void;
  stopScript(): boolean | void;
  runSteps?: (steps: any[], name?: string) => Promise<any>;
  getScriptVars?: () => Record<string, unknown>;

  // ===== 自定义 JS（custom_js 模块挂载，ENGINE_ALLOW_JS 网关控制） =====
  _customJs?: { name: string; cancelled: boolean } | null;
  runCustomJs(name: string, code: string): { ok: boolean; error?: string };
  stopCustomJs(): boolean;

  // ===== 3D 视角（bot_viewer 模块挂载） =====
  startViewer(firstPerson?: boolean, viewDistance?: number): { port: number; reused?: boolean; firstPerson?: boolean; viewDistance?: number };
  stopViewer(): boolean;

  // ===== 供 AI 观测/工具复用 =====
  getMcData(): any;
}

/** BotInstance 构造器形态（CJS class，经 require 引入时用它标注） */
export type BotInstanceCtor = new (
  config: any,
  io: any,
  persist: () => void,
  loadGlobalScripts?: () => Record<string, any>,
) => BotInstance;
