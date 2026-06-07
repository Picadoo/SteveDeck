import http from "http";
import path from "path";
import fs from "fs";
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
import { botManager } from "./botManager";
import { registerHandlers } from "./api/handlers";
import { buildObservation } from "./ai/observe";

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

  app.get("/api/bots", requireToken, (_req: Request, res: Response): void => {
    res.json({ bots: botManager.buildSnapshot() });
  });

  // 物品/方块贴图：复用 prismarine-viewer 自带的逐版本 PNG（如 /textures/1.12.2/items/diamond_sword.png）。
  // 完整版引擎才有这些资源；精简版缺包则跳过挂载，前端 <img> 404 后回退到图标。无需鉴权（仅公开贴图）。
  try {
    const pvDir = path.dirname(require.resolve("prismarine-viewer/package.json"));
    const texRoot = path.join(pvDir, "public", "textures");

    // 智能图标解析：按「真实贴图文件清单 + minecraft-data 物品/方块名」把 id 映射到存在的 PNG，
    // 处理 动画帧(_00) / 物品贴图在 blocks 下 / 命名不符(别名)。按版本缓存。
    // 实体渲染类(箱子/床/旗帜/头颅)本就没平面贴图 → 404 → 前端回退到图标。
    // 命名不符（1.12.2 扁平化前 id≠贴图名）。动画物品(clock/compass…)由 _00 自动处理，无需列。
    const ICON_ALIAS: Record<string, string> = {
      totem_of_undying: "totem",
      golden_apple: "apple_golden",
      golden_carrot: "carrot_golden",
      cooked_beef: "beef_cooked",
      cooked_porkchop: "porkchop_cooked",
      cooked_chicken: "chicken_cooked",
      cooked_mutton: "mutton_cooked",
      cooked_rabbit: "rabbit_cooked",
      cooked_fish: "fish_cod_cooked",
      cooked_salmon: "fish_salmon_cooked",
      redstone: "redstone_dust",
      bow: "bow_standby",
      slime_ball: "slimeball",
      tripwire_hook: "trip_wire_source",
      fishing_rod: "fishing_rod_uncast",
      filled_map: "map_filled",
      map: "map_empty",
      potion: "potion_bottle_drinkable",
      splash_potion: "potion_bottle_splash",
      lingering_potion: "potion_bottle_lingering",
      experience_bottle: "experience_bottle",
      melon: "melon_speckled",
      speckled_melon: "melon_speckled",
      cocoa_beans: "dye_powder_brown",
      // 盔甲架物品图标在 1.12.2 资源里叫 wooden_armorstand（带 wooden_ 前缀、无下划线）
      armor_stand: "wooden_armorstand",
      // 盾牌是模型渲染物品，1.12.2 无 items/shield.png，用实体贴图(无花纹底版)近似
      shield: "entity/shield_base_nopattern",
      // 染料：1.12.2 按 metadata 分色(dye_powder_*)，无统一 dye.png。此处兜底，精确颜色由物品同步按 metadata 处理
      dye: "dye_powder_white",
      ink_sac: "dye_powder_black", // 墨囊=黑色染料
      // 方块类物品：无同名整图，映射到代表性贴图
      red_flower: "flower_rose", // 红花(默认罂粟)
      yellow_flower: "flower_dandelion",
      double_plant: "double_plant_sunflower_front",
      chest: "planks_oak", // 箱子是实体渲染、无平面图，用木板近似
      trapped_chest: "planks_oak",
      tallgrass: "tallgrass",
      waterlily: "waterlily",
      deadbush: "deadbush",
      // 玻璃板/有色玻璃(菜单边框常用)：无 id 整图、且无 metadata 分色 → 统一用透明玻璃近似
      stained_glass_pane: "glass",
      glass_pane: "glass",
      thin_glass: "glass",
      stained_glass: "glass",
      // 楼梯：用对应方块面近似（别名指向不存在的贴图会被 resolve 跳过，无害）
      quartz_stairs: "quartz_block_side",
      stone_stairs: "stone",
      cobblestone_stairs: "cobblestone",
      stone_brick_stairs: "stonebrick",
      brick_stairs: "brick",
      sandstone_stairs: "sandstone_normal",
      red_sandstone_stairs: "red_sandstone_normal",
      nether_brick_stairs: "nether_brick",
      purpur_stairs: "purpur_block",
      oak_stairs: "planks_oak",
      spruce_stairs: "planks_spruce",
      birch_stairs: "planks_birch",
      jungle_stairs: "planks_jungle",
      acacia_stairs: "planks_acacia",
      dark_oak_stairs: "planks_big_oak",
      // 旧版不规则命名
      book: "book_normal",
      written_book: "book_written",
      writable_book: "book_writable",
      enchanted_book: "book_enchanted",
      chicken: "chicken_raw",
      planks: "planks_oak",
      log: "log_oak",
      log2: "log_acacia",
      leaves: "leaves_oak",
      leaves2: "leaves_acacia",
      snow_layer: "snow",
      ender_chest: "obsidian",
      stone_button: "stone",
      wooden_button: "planks_oak",
    };
    const iconMapCache: Record<string, Record<string, string>> = {};
    const getIconMap = (version: string): Record<string, string> => {
      if (iconMapCache[version]) return iconMapCache[version];
      const dir = path.join(texRoot, version);
      const listing = (sub: string): Set<string> => {
        try {
          return new Set(
            fs.readdirSync(path.join(dir, sub)).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4)),
          );
        } catch {
          return new Set<string>();
        }
      };
      const items = listing("items");
      const blocks = listing("blocks");
      const resolve = (name: string): string | null => {
        if (items.has(name)) return `items/${name}`;
        if (blocks.has(name)) return `blocks/${name}`;
        if (items.has(`${name}_00`)) return `items/${name}_00`; // 动画物品取首帧
        if (blocks.has(`${name}_00`)) return `blocks/${name}_00`;
        const a = ICON_ALIAS[name];
        if (a) {
          // 别名可带子目录（如 entity/shield_base_nopattern）：模型渲染物品取实体贴图
          if (a.includes("/")) {
            if (fs.existsSync(path.join(dir, `${a}.png`))) return a;
          } else {
            if (items.has(a)) return `items/${a}`;
            if (blocks.has(a)) return `blocks/${a}`;
          }
        }
        // 1.12.2 命名差异：wooden_X→wood_X、golden_X→gold_X（工具/盔甲整族）
        const ren = name.replace(/^wooden_/, "wood_").replace(/^golden_/, "gold_");
        if (ren !== name) {
          if (items.has(ren)) return `items/${ren}`;
          if (blocks.has(ren)) return `blocks/${ren}`;
        }
        // 上釉陶瓦：<color>_glazed_terracotta → glazed_terracotta_<color>
        const gt = name.match(/^(.+)_glazed_terracotta$/);
        if (gt && blocks.has(`glazed_terracotta_${gt[1]}`)) return `blocks/glazed_terracotta_${gt[1]}`;
        // 多面方块(熔炉/工作台/活板门等)：无同名整图，取一个代表面
        for (const suf of ["_front_off", "_front", "_top", "_side", "_inventory", "_0"]) {
          if (blocks.has(`${name}${suf}`)) return `blocks/${name}${suf}`;
        }
        return null;
      };
      const map: Record<string, string> = {};
      try {
        const mcData = require("minecraft-data")(version);
        for (const it of mcData.itemsArray || []) {
          const p = resolve(it.name);
          if (p) map[it.name] = p;
        }
        for (const bl of mcData.blocksArray || []) {
          if (map[bl.name]) continue;
          const p = resolve(bl.name);
          if (p) map[bl.name] = p;
        }
      } catch {
        /* 该版本无 minecraft-data：退化为只认存在的文件名 */
      }
      for (const n of items) if (!map[n]) map[n] = `items/${n}`;
      for (const n of blocks) if (!map[n]) map[n] = `blocks/${n}`;
      iconMapCache[version] = map;
      return map;
    };

    // 解析端点：/textures/1.12.2/_icon/totem_of_undying.png → 实际 items/totem.png（命中即 200 image/png）
    app.get("/textures/:version/_icon/:name", (req: Request, res: Response): void => {
      const version = String(req.params.version);
      const name = String(req.params.name).replace(/\.png$/i, "").toLowerCase();
      const rel = getIconMap(version)[name];
      if (!rel) {
        res.set("Cache-Control", "no-store"); // 404 不缓存：新增别名/换版本后立即生效，不被旧 404 卡住
        res.status(404).end();
        return;
      }
      // 重定向到已验证可用的静态贴图（绕开 express5 sendFile 对绝对路径的怪异 NotFound；静态层负责 MIME/缓存）
      res.set("Cache-Control", "public, max-age=604800");
      res.redirect(302, `/textures/${version}/${rel}.png`);
    });

    app.use("/textures", express.static(texRoot, { maxAge: "7d", fallthrough: true }));
  } catch {
    /* 精简版无 prismarine-viewer，跳过贴图静态服务 */
  }

  // ===== AI 接口：感知世界状态 + 提交脚本 =====
  app.get("/api/observe/:id", requireToken, (req: Request, res: Response): void => {
    const obs = buildObservation(String(req.params.id));
    if (!obs) {
      res.status(404).json({ error: "bot not found" });
      return;
    }
    res.json(obs);
  });

  // 主动探索：用背包里某个名字的物品打开 GUI，抓取完整内容后关闭，返回结构（AI 可据此搞清服务器定制菜单）。
  // GET /api/explore/:id?item=自助菜单   或不带 item → 列出可探查的菜单候选物品
  app.post("/api/explore/:id", requireToken, async (req: Request, res: Response): Promise<void> => {
    const inst: any = botManager.getInstance(String(req.params.id));
    if (!inst) {
      res.status(404).json({ error: "bot not found" });
      return;
    }
    const item = String(req.query.item || req.body?.item || "");
    try {
      if (!item) {
        res.json({ candidates: inst.listMenuCandidates?.() ?? [] });
        return;
      }
      const result = await inst.exploreMenuItem(item, {
        keep: !!req.body?.keep,
        clickPath: Array.isArray(req.body?.clickPath) ? req.body.clickPath : undefined,
      });
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message ?? e) });
    }
  });

  app.post("/api/ai/script/:id", requireToken, (req: Request, res: Response): void => {
    const id = String(req.params.id);
    const body = req.body || {};
    const script = body.script ?? body;
    if (!script || !script.name || !Array.isArray(script.steps)) {
      res.status(400).json({ error: "invalid script: need { name, steps[] }" });
      return;
    }
    const lib = botManager.loadScripts();
    lib[script.name] = script;
    botManager.saveScripts(lib);
    botManager.eachInstance((inst: any) => inst.preloadScripts && inst.preloadScripts(lib));
    let started = false;
    if (body.run !== false) {
      const inst = botManager.getInstance(id);
      if (inst?.startScript) {
        try {
          inst.preloadScripts?.(lib);
          inst.startScript(script.name);
          started = true;
        } catch {
          /* ignore */
        }
      }
    }
    res.json({ ok: true, saved: script.name, started });
  });

  const server = http.createServer(app);
  const io = new IOServer(server, { cors: { origin: "*" } });

  // 令牌握手鉴权
  io.use((socket, next) => {
    const auth = socket.handshake.auth as HandshakeAuth;
    if (!auth || auth.token !== token) {
      next(new Error("unauthorized"));
      return;
    }
    next();
  });

  botManager.init(io);

  io.on("connection", (socket) => {
    socket.emit(ServerEvents.ENGINE_INFO, {
      version: ENGINE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
    });
    registerHandlers(io, socket);
  });

  // 默认绑 0.0.0.0（Docker/远程引擎需对外可达）；内置桌面版会传 ENGINE_HOST=127.0.0.1 收紧为仅本机回环
  const host = process.env.ENGINE_HOST || "0.0.0.0";
  await new Promise<void>((resolve) => {
    server.listen(port, host, () => resolve());
  });

  botManager.startAll();

  return { app, server, io, port, token };
}
