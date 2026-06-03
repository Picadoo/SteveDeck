import { Server as IOServer, Socket } from "socket.io";
import { ClientCommands, ServerEvents, CommandAck, BotSettings } from "@mcbot/protocol";
import { botManager } from "../botManager";
import { Ack, ok, fail } from "./ack";

function persistSettings(id: string, mutate: (s: BotSettings) => void): void {
  const cfg = botManager.getConfigs().find((c) => c.id === id);
  if (cfg) {
    cfg.settings = cfg.settings || {};
    mutate(cfg.settings);
    botManager.save();
  }
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
          case "trash_cleaner":
            inst.toggleTrashCleaner?.(active, (config && config.items) || config || []);
            persistSettings(id, (s) => ((s as any).trash_cleaner = active));
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
          inst.combatConfig = { ...inst.combatConfig, ...config };
          persistSettings(id, (s) => (s.combatConfig = inst.combatConfig));
        } else if (module === "auto_farm") {
          persistSettings(id, (s) => (s.autoFarm = { ...(s.autoFarm as object), ...config }));
        } else if (module === "mob_hunter") {
          persistSettings(id, (s) => (s.mobHunter = { active: !!inst.mobHunterTask?.active, config }));
        } else if (module === "automine") {
          persistSettings(id, (s) => (s.autoMine = { active: !!inst.autoMineTask?.active, config }));
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
      return inst
        .clickWindowSlot(Number(args.slot), Number(args.button ?? 0), Number(args.mode ?? 0))
        .then((w: any) => ok(w))
        .catch((e: any) => fail(String(e?.message ?? e)));
    case "window:close":
      return ok({ closed: inst.closeGui?.() ?? false });
    case "window:openAt":
      return inst
        .openContainerAt(Number(args.x), Number(args.y), Number(args.z))
        .then((w: any) => ok(w))
        .catch((e: any) => fail(String(e?.message ?? e)));

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
      if (process.env.ENGINE_ALLOW_JS === "0")
        return fail("引擎已禁用自定义 JS（设 ENGINE_ALLOW_JS=1 开启）");
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
      const res = inst.saveLocation?.(
        String(args.name || ""),
        args.command ? String(args.command) : undefined,
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
      const res = inst.goToLocation?.(String(args.locationId));
      return res?.success ? ok() : fail(res?.error || "前往失败");
    }
    case "npc:scan":
      return ok(inst.scanNearbyNPCs?.() ?? []);
    case "npc:interact":
      inst.interactWithNPC?.(String(args.name || ""));
      return ok();
    case "container:scan":
      return ok(inst.scanContainers?.() ?? []);
    case "move:goto":
      inst.move?.(Number(args.x), Number(args.y), Number(args.z));
      return ok();
    case "move:stop":
      try {
        inst.bot?.pathfinder?.setGoal(null);
      } catch {
        /* ignore */
      }
      return ok();
    case "scoreboard:get":
      return ok(inst.getScoreboard?.() ?? null);
    case "inventory:sync":
      inst.syncInventory?.();
      return ok();
    case "inventory:drop":
      return inst
        .dropSlot(Number(args.slot))
        .then(() => ok())
        .catch((e: any) => fail(String(e?.message ?? e)));
    case "inventory:equip":
      return inst
        .equipSlot(Number(args.slot))
        .then(() => ok())
        .catch((e: any) => fail(String(e?.message ?? e)));
    case "inventory:use":
      return inst
        .useSlot(Number(args.slot))
        .then(() => ok())
        .catch((e: any) => fail(String(e?.message ?? e)));
    case "scheduler:add": {
      ensureSchedules(inst);
      inst.config.settings.schedules.push(args.schedule);
      botManager.save();
      io.emit(ServerEvents.MODULE_STATE, { id, module: "scheduler", state: { schedules: inst.config.settings.schedules } });
      return ok(inst.config.settings.schedules);
    }
    case "scheduler:remove": {
      ensureSchedules(inst);
      inst.config.settings.schedules.splice(Number(args.index), 1);
      botManager.save();
      io.emit(ServerEvents.MODULE_STATE, { id, module: "scheduler", state: { schedules: inst.config.settings.schedules } });
      return ok(inst.config.settings.schedules);
    }
    case "scheduler:list":
      ensureSchedules(inst);
      return ok(inst.config.settings.schedules);
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
