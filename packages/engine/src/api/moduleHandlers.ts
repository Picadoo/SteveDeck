import { Server as IOServer, Socket } from "socket.io";
import { ClientCommands, ServerEvents, CommandAck, BotSettings } from "@mcbot/protocol";
import { botManager } from "../botManager";
import { Ack, ok, fail } from "./ack";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isChatBlocked } = require("../utils/chatSafety"); // 命令安全过滤(API-1)：存储前即时拦截

function persistSettings(id: string, mutate: (s: BotSettings) => void): void {
  const cfg = botManager.getConfigs().find((c) => c.id === id);
  if (cfg) {
    cfg.settings = cfg.settings || {};
    mutate(cfg.settings);
    botManager.save();
  }
}

// 战斗配置：把客户端传来的 config 按「已知键白名单 + 类型校验」逐字段拷进引擎状态(API-7)。
// 之前用 { ...inst.combatConfig, ...config } 直接 spread 原始客户端对象，会让任意键混入引擎运行态
// （污染/覆盖内部字段、塞进巨型对象等）。这里只接受 combat.js / BotInstance.js 定义的合法字段，
// 类型不符的键静默忽略；range 额外做范围夹取，避免 0/负数/超大值算出异常的攻击半径。
function sanitizeCombatConfig(prev: any, config: any): any {
  const out = { ...(prev || {}) };
  if (!config || typeof config !== "object") return out;
  if (typeof config.enabled === "boolean") out.enabled = config.enabled;
  if (typeof config.antiKb === "boolean") out.antiKb = config.antiKb;
  if (typeof config.attackPlayers === "boolean") out.attackPlayers = config.attackPlayers;
  if (typeof config.attackMobs === "boolean") out.attackMobs = config.attackMobs;
  if (typeof config.range === "number" && Number.isFinite(config.range)) {
    out.range = Math.max(1, Math.min(6, config.range)); // 攻击半径夹到合理区间(原版手够≈3-6)
  }
  if (typeof config.maxTargets === "number" && Number.isFinite(config.maxTargets)) {
    out.maxTargets = Math.max(1, Math.min(10, Math.floor(config.maxTargets)));
  }
  return out;
}

/** 注册全部功能模块的命令（开关 / 配置 / 动作）。 */
export function registerModuleHandlers(io: IOServer, socket: Socket): void {
  socket.on(
    ClientCommands.MODULE_TOGGLE,
    (
      { id, module, active, config }: { id: string; module: string; active: boolean; config?: any },
      ack?: Ack,
    ) => {
      const inst = botManager.getInstance(id);
      if (!inst) return ack?.(fail("机器人不存在"));
      try {
        switch (module) {
          case "combat":
            inst.combatConfig.enabled = active;
            persistSettings(id, (s) => (s.combat = active));
            break;
          case "fishing":
            if (typeof inst.setFishing === "function") inst.setFishing(active);
            else inst.fishingActive = active;
            persistSettings(id, (s) => (s.fishing = active));
            break;
          case "automine":
            inst.toggleAutoMine?.(active, config || {});
            persistSettings(id, (s) => (s.autoMine = { active, config: inst.autoMineTask?.config || config || {} }));
            break;
          case "auto_farm":
            inst.toggleAutoFarm?.(active, config || {});
            persistSettings(id, (s) => (s.autoFarm = active ? config || inst.farmTask?.config || {} : undefined));
            break;
          case "mob_hunter":
            inst.toggleMobHunter?.(active, config || {});
            persistSettings(id, (s) => (s.mobHunter = { active, config: config || {} }));
            break;
          case "trash_cleaner": {
            const items = (config && config.items) || config || [];
            inst.toggleTrashCleaner?.(active, items);
            // 存 {active, items}：之前只存了布尔值，重连后丢失黑名单
            persistSettings(id, (s) => ((s as any).trash_cleaner = { active, items }));
            break;
          }
          case "auto_use":
            inst.toggleAutoUse?.(active, config || {});
            persistSettings(
              id,
              (s) => ((s as any).autoUse = { active, rules: inst.autoUseTask?.rules || (config && config.rules) || [] }),
            );
            break;
          default:
            return ack?.(fail(`未知模块 ${module}`));
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
    ({ id, module, config }: { id: string; module: string; config: any }, ack?: Ack) => {
      const inst = botManager.getInstance(id);
      if (!inst) return ack?.(fail("机器人不存在"));
      try {
        if (module === "combat") {
          // 白名单逐字段拷贝 + 类型校验，不把原始客户端对象 spread 进引擎状态(API-7)
          inst.combatConfig = sanitizeCombatConfig(inst.combatConfig, config);
          persistSettings(id, (s) => (s.combatConfig = inst.combatConfig));
        } else if (module === "auto_farm") {
          persistSettings(id, (s) => (s.autoFarm = { ...(s.autoFarm as object), ...config }));
        } else if (module === "mob_hunter") {
          persistSettings(id, (s) => (s.mobHunter = { active: !!inst.mobHunterTask?.active, config }));
        } else if (module === "automine") {
          persistSettings(id, (s) => (s.autoMine = { active: !!inst.autoMineTask?.active, config }));
        } else if (module === "auto_use") {
          if (config && Array.isArray(config.rules) && inst.autoUseTask) inst.autoUseTask.rules = config.rules;
          persistSettings(
            id,
            (s) => ((s as any).autoUse = { active: !!inst.autoUseTask?.active, rules: inst.autoUseTask?.rules || [] }),
          );
        }
        io.emit(ServerEvents.MODULE_STATE, { id, module, state: config });
        ack?.(ok());
      } catch (e: any) {
        ack?.(fail(String(e?.message ?? e)));
      }
    },
  );

  socket.on(
    ClientCommands.MODULE_ACTION,
    async (
      { id, module, action, args = {} }: { id: string; module: string; action: string; args?: any },
      ack?: Ack,
    ) => {
      const inst = botManager.getInstance(id);
      if (!inst) return ack?.(fail("机器人不存在"));
      try {
        ack?.(await dispatchAction(io, inst, id, module, action, args));
      } catch (e: any) {
        ack?.(fail(String(e?.message ?? e)));
      }
    },
  );
}

function dispatchAction(
  io: IOServer,
  inst: any,
  id: string,
  module: string,
  action: string,
  args: any,
): CommandAck | Promise<CommandAck> {
  switch (`${module}:${action}`) {
    case "window:get":
      return ok(inst.getWindow?.() ?? null);
    case "window:click":
      // 录制：按点中槽位的物品名录成 find_and_click_slot（趁界面还开着、槽位有物品）
      inst.recorder?.note?.("window_click", { slot: Number(args.slot), button: Number(args.button ?? 0) });
      return inst
        .clickWindowSlot(Number(args.slot), Number(args.button ?? 0), Number(args.mode ?? 0))
        .then((w: any) => ok(w))
        .catch((e: any) => fail(String(e?.message ?? e)));
    case "window:close":
      inst.recorder?.note?.("window_close", {});
      return ok({ closed: inst.closeGui?.() ?? false });
    case "window:openAt":
      return inst
        .openContainerAt(Number(args.x), Number(args.y), Number(args.z))
        .then((w: any) => ok(w))
        .catch((e: any) => fail(String(e?.message ?? e)));
    // 主动探查：用背包物品开菜单→抓内容→关闭（玩家一键看清菜单里有什么）
    case "window:explore":
      return inst
        .exploreMenuItem(String(args.item || ""), {
          clickPath: Array.isArray(args.clickPath) ? args.clickPath : undefined,
          keep: !!args.keep,
        })
        .then((r: any) => ok(r))
        .catch((e: any) => fail(String(e?.message ?? e)));
    case "window:menuCandidates":
      return ok(inst.listMenuCandidates?.() ?? []);

    // ===== 原生 JS 自定义脚本 =====
    case "js:list":
      return ok(
        Object.values(botManager.loadCustomScripts()).map((s: any) => ({
          name: s.name,
          pinned: !!s.pinned,
          updatedAt: s.updatedAt || s.createdAt || null,
        })),
      );
    case "js:get":
      return ok(botManager.loadCustomScripts()[String(args.name)] ?? null);
    case "js:save": {
      const name = String(args.name || "").trim();
      if (!name) return fail("脚本名不能为空");
      const lib = botManager.loadCustomScripts();
      const now = Date.now();
      lib[name] = {
        name,
        code: String(args.code || ""),
        pinned: !!lib[name]?.pinned,
        createdAt: lib[name]?.createdAt || now,
        updatedAt: now,
      };
      botManager.saveCustomScripts(lib);
      return ok();
    }
    case "js:pin": {
      const lib = botManager.loadCustomScripts();
      const s = lib[String(args.name)];
      if (!s) return fail("脚本不存在");
      s.pinned = !!args.pinned;
      botManager.saveCustomScripts(lib);
      return ok();
    }
    case "js:delete": {
      const lib = botManager.loadCustomScripts();
      delete lib[String(args.name)];
      botManager.saveCustomScripts(lib);
      return ok();
    }
    case "js:run": {
      // 默认关闭：自定义 JS 等于在引擎主机上执行任意代码（可读 bots.json 明文密码、跑系统命令），
      // 而移动端是带令牌的局域网配对——默认开放≈持令牌即可 RCE。需显式 ENGINE_ALLOW_JS=1 开启。
      if (process.env.ENGINE_ALLOW_JS !== "1")
        return fail("引擎已禁用自定义 JS（有主机代码执行风险）。需在引擎 .env 设 ENGINE_ALLOW_JS=1 开启");
      const code =
        args.code != null
          ? String(args.code)
          : String(botManager.loadCustomScripts()[String(args.name)]?.code || "");
      if (!code.trim()) return fail("脚本为空");
      if (!inst.runCustomJs) return fail("机器人需在线才能运行");
      const r = inst.runCustomJs(String(args.name || "临时脚本"), code);
      return r?.ok ? ok() : fail(r?.error || "运行失败");
    }
    case "js:stop":
      return ok({ stopped: inst.stopCustomJs?.() ?? false });

    // ===== 机器人视角（prismarine-viewer web） =====
    case "viewer:start":
      return ok(inst.startViewer(!!args.firstPerson));
    case "viewer:stop":
      return ok({ stopped: inst.stopViewer?.() ?? false });
    case "viewer:clickWalk":
      return ok({ clickWalk: inst.setViewerClickWalk?.(!!args.enabled) ?? false });
    case "auto_farm:scan":
      inst.scanFarmland?.();
      return ok();
    case "auto_farm:stats":
      return ok(inst.getFarmStats?.() ?? null);
    case "automine:stats":
      return ok(inst.getMineStats?.() ?? null);
    case "mob_hunter:stats":
      return ok(inst.getMobHunterStats?.() ?? null);
    case "mob_hunter:areaCircle": {
      const res = inst.setHuntAreaCircle?.(Number(args.radius) || 50);
      if (res?.success) persistHunterArea(id, inst);
      return res?.success ? ok(res) : fail(res?.error || "设置失败");
    }
    case "mob_hunter:areaBox": {
      const c = ["x1", "y1", "z1", "x2", "y2", "z2"].map((k) => Number(args[k]) || 0);
      const res = inst.setHuntAreaBox?.(...c);
      if (res?.success) persistHunterArea(id, inst);
      return res?.success ? ok(res) : fail(res?.error || "设置失败");
    }
    case "mob_hunter:return":
      inst.returnToHuntArea?.();
      return ok();
    case "location:save": {
      if (args.command && isChatBlocked(String(args.command))) return fail("到达指令被安全过滤拦截"); // API-1
      const res = inst.saveLocation?.(
        String(args.name || ""),
        args.command ? String(args.command) : undefined,
        Array.isArray(args.steps) ? args.steps : undefined,
      );
      if (res?.success) {
        persistLocations(id, inst);
        return ok(res.location);
      }
      return fail(res?.error || "保存失败");
    }
    case "location:delete": {
      const res = inst.deleteLocation?.(String(args.locationId));
      if (res?.success) {
        persistLocations(id, inst);
        return ok();
      }
      return fail(res?.error || "删除失败");
    }
    case "location:goto": {
      const loc = (inst.savedLocations || []).find(
        (l: any) => l.id === args.locationId || l.name === args.locationId,
      );
      inst.recorder?.note?.("goto_location", { name: loc?.name || String(args.locationId) });
      const res = inst.goToLocation?.(String(args.locationId));
      return res?.success ? ok() : fail(res?.error || "前往失败");
    }
    case "location:set-reach": {
      if (args.command && isChatBlocked(String(args.command))) return fail("到达指令被安全过滤拦截"); // API-1
      const res = inst.setLocationReach?.(String(args.locationId), {
        command: args.command !== undefined ? String(args.command || "") : undefined,
        steps: Array.isArray(args.steps) ? args.steps : undefined,
      });
      if (res?.success) {
        persistLocations(id, inst);
        return ok(res.location);
      }
      return fail(res?.error || "更新失败");
    }
    case "npc:scan":
      return ok(inst.scanNearbyNPCs?.() ?? []);
    case "npc:interact":
      inst.interactWithNPC?.(String(args.name || ""));
      return ok();
    case "container:scan":
      return ok(inst.scanContainers?.() ?? []);
    case "move:goto": {
      const gx = Number(args.x), gy = Number(args.y), gz = Number(args.z);
      if (![gx, gy, gz].every(Number.isFinite)) return fail("坐标无效"); // API-11：挡 NaN 入寻路
      inst.recorder?.note?.("goto", { x: gx, y: gy, z: gz });
      inst.move?.(gx, gy, gz);
      return ok();
    }
    case "move:stop":
      try {
        inst.bot?.pathfinder?.setGoal(null);
        inst.bot?.clearControlStates?.();
        inst.stopRawMove?.(); // 直接移动模式：停掉坐标包循环、恢复物理
      } catch {
        /* ignore */
      }
      return ok();

    // ===== 手动操控（虚拟摇杆 / 方向键）：setControlState 持续控制 =====
    case "move:control": {
      const b = inst.bot;
      if (!b?.entity) return fail("机器人离线");
      try {
        b.pathfinder?.setGoal(null); // 手动控制时停掉寻路，避免互相打架
      } catch {
        /* ignore */
      }
      // 模组服：物理算不动 → 走「直接坐标包移动」（同一套 UI 控制，引擎侧透明切换）
      if (inst.rawMoveEnabled) {
        try {
          inst.setRawControl(args);
        } catch {
          /* ignore */
        }
        return ok();
      }
      for (const s of ["forward", "back", "left", "right", "jump", "sprint", "sneak"]) {
        if (s in args) {
          try {
            b.setControlState(s, !!args[s]);
          } catch {
            /* ignore */
          }
        }
      }
      return ok();
    }
    case "move:turn": {
      const b = inst.bot;
      if (!b?.entity) return fail("机器人离线");
      const yaw = b.entity.yaw + (Number(args.dyaw) || 0);
      const pitch = Math.max(
        -Math.PI / 2,
        Math.min(Math.PI / 2, b.entity.pitch + (Number(args.dpitch) || 0)),
      );
      try {
        b.look(yaw, pitch, false);
      } catch {
        /* ignore */
      }
      return ok();
    }

    // ===== 模拟按键：一次性动作（攻击/使用/换手/丢弃/选快捷栏）。无头 bot 发对应封包，服务器可感知。 =====
    case "move:tap": {
      const b = inst.bot;
      if (!b?.entity) return fail("机器人离线");
      const act = String(args.action || "");
      try {
        if (act === "attack") {
          b.swingArm?.("right"); // 左键挥手（攻击动画/命中判定由服务器处理）
        } else if (act === "use") {
          b.activateItem?.(); // 右键使用手持物
          setTimeout(() => { try { b.deactivateItem?.(); } catch { /* ignore */ } }, 120);
        } else if (act === "swap") {
          if (typeof b.swapHandItems === "function") b.swapHandItems().catch(() => {}); // F 换手
        } else if (act === "drop") {
          const it = b.heldItem;
          if (it) b.toss(it.type, it.metadata ?? null, 1).catch(() => {}); // Q 丢弃一个
        } else if (act === "slot") {
          const n = Math.max(0, Math.min(8, Math.floor(Number(args.slot) || 0)));
          b.setQuickBarSlot?.(n); // 选快捷栏 0-8
        } else {
          return fail("未知动作");
        }
      } catch {
        /* ignore */
      }
      return ok();
    }

    // ===== 行为设置：寻路破坏模式 / 复活后指令 =====
    case "behavior:get":
      return ok({
        allowDig: !!inst.config?.settings?.allowDig,
        respawnCommand: inst.config?.settings?.respawnCommand || "",
      });
    case "behavior:setDig": {
      const allow = !!args.allow;
      persistSettings(id, (s) => {
        (s as any).allowDig = allow;
      });
      inst.applyMovements?.(); // 立即生效，无需重连
      return ok({ allowDig: allow });
    }
    case "behavior:setRespawnCmd": {
      const c = String(args.command || "").trim();
      // API-1：存储前过安全过滤（即时反馈；执行时 BotInstance 也会再过一道）
      if (c && isChatBlocked(c)) return fail("该指令被安全过滤拦截，未保存");
      persistSettings(id, (s) => {
        (s as any).respawnCommand = c || undefined;
      });
      return ok({ respawnCommand: c });
    }
    // ===== 通用消息监听统计 =====
    case "monitor:get":
      return ok(inst.getMonitor?.() ?? { rules: [], stats: {} });
    case "monitor:setRules":
      return ok(inst.setMonitorRules?.(args.rules || []) ?? { rules: [], stats: {} });
    case "monitor:reset":
      return ok(inst.resetMonitorStats?.() ?? { rules: [], stats: {} });
    case "monitor:test":
      return ok(
        inst.testMonitorRule?.(args.pattern, args.valueGroup, !!args.numberMode, args.sample) ?? {
          ok: false,
        },
      );
    case "scoreboard:get":
      return ok(inst.getScoreboard?.() ?? null);
    case "inventory:sync":
      inst.syncInventory?.();
      return ok();
    case "inventory:drop":
      inst.recorder?.note?.("drop", { slot: Number(args.slot) });
      return inst
        .dropSlot(Number(args.slot))
        .then(() => ok())
        .catch((e: any) => fail(String(e?.message ?? e)));
    case "inventory:equip":
      inst.recorder?.note?.("equip", { slot: Number(args.slot) });
      return inst
        .equipSlot(Number(args.slot))
        .then(() => ok())
        .catch((e: any) => fail(String(e?.message ?? e)));
    case "inventory:hold":
      inst.recorder?.note?.("equip", { slot: Number(args.slot) });
      return inst
        .holdSlot(Number(args.slot))
        .then(() => ok())
        .catch((e: any) => fail(String(e?.message ?? e)));
    case "inventory:use":
      // 录制要趁物品还在原槽位：先记录再执行（useSlot 会把物品移到手上）
      inst.recorder?.note?.("use", { slot: Number(args.slot) });
      return inst
        .useSlot(Number(args.slot))
        .then(() => ok())
        .catch((e: any) => fail(String(e?.message ?? e)));
    case "scheduler:add": {
      ensureSchedules(inst);
      const sched = args.schedule;
      // API-9：形状校验——必须是普通对象，且总数有上限，避免垃圾对象入盘 / 无界增长
      if (!sched || typeof sched !== "object" || Array.isArray(sched)) return fail("定时任务格式无效");
      if (inst.config.settings.schedules.length >= 50) return fail("定时任务数量已达上限(50)");
      inst.config.settings.schedules.push(sched);
      botManager.save();
      io.emit(ServerEvents.MODULE_STATE, { id, module: "scheduler", state: { schedules: inst.config.settings.schedules } });
      return ok(inst.config.settings.schedules);
    }
    case "scheduler:remove": {
      ensureSchedules(inst);
      const idx = Number(args.index);
      // API-9：索引边界——NaN/负数/越界会让 splice 静默删错条目或无效
      if (!Number.isInteger(idx) || idx < 0 || idx >= inst.config.settings.schedules.length)
        return fail("定时任务索引无效");
      inst.config.settings.schedules.splice(idx, 1);
      botManager.save();
      io.emit(ServerEvents.MODULE_STATE, { id, module: "scheduler", state: { schedules: inst.config.settings.schedules } });
      return ok(inst.config.settings.schedules);
    }
    case "scheduler:list":
      ensureSchedules(inst);
      return ok(inst.config.settings.schedules);
    // ===== 录制：把玩家操作录成脚本步骤 =====
    case "recording:start":
      return ok(inst.recorder?.start?.() ?? { active: false, count: 0 });
    case "recording:stop":
      return ok(inst.recorder?.stop?.() ?? { steps: [], count: 0 });
    case "recording:status":
      return ok(inst.recorder?.status?.() ?? { active: false, count: 0, last: null });
    case "recording:mark": {
      // 踩点：取机器人当前精确坐标；录制中则插一条 goto，否则只回坐标供前端复制/存地点
      const p = inst.bot?.entity?.position;
      if (!p) return fail("机器人不在线");
      const coord = { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) };
      const rec = !!inst.recorder?.active;
      if (rec) inst.recorder.note("goto", coord);
      return ok({ ...coord, recorded: rec });
    }
    default:
      return fail(`未知操作 ${module}:${action}`);
  }
}

function ensureSchedules(inst: any): void {
  inst.config.settings = inst.config.settings || {};
  if (!Array.isArray(inst.config.settings.schedules)) inst.config.settings.schedules = [];
}

function persistLocations(id: string, inst: any): void {
  persistSettings(id, (s) => {
    s.savedLocations = inst.savedLocations;
  });
}

function persistHunterArea(id: string, inst: any): void {
  persistSettings(id, (s) => {
    const cur = (s.mobHunter && (s.mobHunter as any).config) || {};
    s.mobHunter = {
      active: !!inst.mobHunterTask?.active,
      config: { ...cur, huntArea: inst.mobHunterTask?.huntArea },
    };
  });
}
