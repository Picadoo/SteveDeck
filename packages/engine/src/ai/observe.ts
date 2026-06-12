import { botManager } from "../botManager";

// 物品/装备摘要助手（CJS 工具，引擎以 require 复用）
const { itemBrief, enchantNames } = require("../utils/items");

/** 读取最大生命属性（RPG 服常 >20），取不到回退 20。 */
function maxHealthOf(bot: any): number {
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

/** 其他实体（怪/NPC/Boss）当前血量：优先 entity.health，否则按注册表/下标从元数据取。取不到返回 null */
function entityHealth(bot: any, e: any): number | null {
  if (typeof e?.health === "number") return e.health;
  const md = e?.metadata;
  if (md && typeof md === "object") {
    try {
      const keys = bot?.registry?.entitiesByName?.[e?.name]?.metadataKeys;
      if (Array.isArray(keys)) {
        const idx = keys.indexOf("health");
        if (idx >= 0 && typeof md[idx] === "number") return md[idx];
      }
    } catch {
      /* ignore */
    }
    if (typeof md[7] === "number") return md[7]; // 1.12.2 生物血量常在下标 7
    if (typeof md[6] === "number") return md[6];
  }
  return null;
}

/** 实体最大血量（服务器若下发了属性）；取不到返回 null */
function entityMaxHealth(e: any): number | null {
  try {
    const a = e?.attributes;
    if (a) {
      const x =
        a["minecraft:generic.max_health"] || a["generic.maxHealth"] || a["generic.max_health"];
      const v = x?.value;
      if (typeof v === "number" && v > 0) return v;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** 把 ChatMessage / 字符串安全转成去色码纯文本，空则 null */
function txt(v: any): string | null {
  if (v == null) return null;
  try {
    if (typeof v === "string") return v.replace(/§./gi, "").trim() || null;
    if (typeof v.toString === "function") {
      const s = v.toString();
      if (typeof s === "string" && s !== "[object Object]")
        return s.replace(/§./gi, "").trim() || null;
    }
    // JSON 聊天组件 {text, extra}
    if (typeof v.text === "string" || Array.isArray(v.extra)) {
      const flat =
        (v.text || "") +
        (Array.isArray(v.extra)
          ? v.extra.map((e: any) => (typeof e === "string" ? e : (e && e.text) || "")).join("")
          : "");
      const cleaned = flat.replace(/§./gi, "").trim();
      if (cleaned) return cleaned;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** 同 txt，但保留 §/§x 颜色码（供前端 McText 彩色渲染，如 Tab 称号色）；空则 null */
function txtC(v: any): string | null {
  if (v == null) return null;
  try {
    if (typeof v === "string") return v.trim() || null;
    if (typeof v.toMotd === "function") {
      const s = v.toMotd();
      if (s) return String(s).trim() || null;
    }
    if (typeof v.toString === "function") {
      const s = v.toString();
      if (s && s !== "[object Object]") return s.trim() || null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** 取实体的自定义名牌（去色码），无则 null */
function entityCustomName(e: any): string | null {
  // 名牌：1.12.2 在 metadata[2]（mineflayer 不一定填 customName），其次 customName，最后 displayName 对象
  let src = e?.customName;
  if (src == null && e?.metadata) src = e.metadata[2];
  if (src == null && typeof e?.displayName === "object") src = e.displayName;
  return txt(src);
}

/** 视线水平朝向 → 方位+坐标轴（用 mineflayer 自身公式，确保与实际移动一致） */
function facingOf(yaw: number): string {
  const dx = -Math.sin(yaw);
  const dz = -Math.cos(yaw);
  if (Math.abs(dx) >= Math.abs(dz)) return dx > 0 ? "东 (+X)" : "西 (-X)";
  return dz > 0 ? "南 (+Z)" : "北 (-Z)";
}

/** timeOfDay(tick) → 白天/黄昏/夜晚/黎明 */
function dayPhase(t: number): string {
  const d = (((t || 0) % 24000) + 24000) % 24000;
  if (d < 12000) return "白天";
  if (d < 13800) return "黄昏";
  if (d < 22200) return "夜晚";
  return "黎明";
}

/** 当前状态效果（药水 buff/debuff）：名称 + 等级 + 剩余秒 + 是否负面 */
function effectsOf(bot: any, mcData: any): any[] {
  try {
    const eff = bot?.entity?.effects;
    if (!eff) return [];
    return Object.values(eff)
      .map((e: any) => {
        const info = mcData?.effects?.[e?.id];
        return {
          name: info?.displayName || info?.name || `effect_${e?.id}`,
          level: (e?.amplifier ?? 0) + 1, // amplifier 0 = I 级
          seconds: typeof e?.duration === "number" ? Math.round(e.duration / 20) : null,
          bad: info?.type === "bad",
        };
      })
      .filter((e: any) => e.name);
  } catch {
    return [];
  }
}

/** 实体是否敌对（按 minecraft-data 分类 kind） */
function isHostile(kind: any): boolean {
  return /hostile/i.test(String(kind || ""));
}

/** 告示牌文字：优先新 API getSignText（兼容多版本），回退旧属性/方块实体 NBT（1.12.2 Text1-4 JSON） */
function signTextOf(block: any): string | null {
  if (!block) return null;
  const clean = (s: string) => s.replace(/§./g, "").replace(/\s+/g, " ").trim();
  try {
    if (typeof block.getSignText === "function") {
      const parts = block.getSignText();
      const t = clean([].concat(parts || []).filter(Boolean).join(" "));
      if (t) return t;
    }
  } catch { /* 回退 */ }
  try {
    if (block.signText) {
      const t = clean(String(block.signText));
      if (t) return t;
    }
  } catch { /* 回退 */ }
  try {
    const be = block.blockEntity;
    if (be) {
      const lines: string[] = [];
      for (const k of ["Text1", "Text2", "Text3", "Text4"]) {
        let v: any = be[k];
        if (v && typeof v === "object" && "value" in v) v = v.value; // nbt 包裹
        if (v == null) continue;
        const s = String(v);
        // 1.12.2 行内容是 JSON 聊天组件字符串
        const t2 = txt(s.startsWith("{") || s.startsWith("\"") ? safeJson(s) ?? s : s);
        if (t2) lines.push(t2);
      }
      const t = clean(lines.join(" "));
      if (t) return t;
    }
  } catch { /* 没有就算了 */ }
  return null;
}

function safeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** 物品耐久百分比：有最大耐久时返回剩余百分比，否则 null */
function durabilityPct(item: any): number | null {
  if (!item) return null;
  try {
    const maxDur = item.maxDurability;
    if (typeof maxDur === "number" && maxDur > 0) {
      const used = item.durabilityUsed ?? 0;
      return Math.round(((maxDur - used) / maxDur) * 100);
    }
  } catch { /* ignore */ }
  return null;
}

/** 脚下/脚部/头部方块快照 */
function blockScan(bot: any): any {
  try {
    const pos = bot.entity.position;
    const below = bot.blockAt(pos.offset(0, -1, 0));
    const feet = bot.blockAt(pos);
    const head = bot.blockAt(pos.offset(0, 1, 0));
    const blockName = (b: any) => b?.name || "unknown";
    return {
      below: blockName(below),
      atFeet: blockName(feet),
      atHead: blockName(head),
      lightLevel: typeof feet?.light === "number" ? feet.light : (typeof feet?.skyLight === "number" ? feet.skyLight : null),
      biome: below?.biome?.name ?? null,
    };
  } catch {
    return null;
  }
}

/** 把机器人当前可感知的世界状态整理成 AI 友好的快照。 */
export function buildObservation(id: string): any {
  const inst = botManager.getInstance(id);
  const cfg = botManager.getConfig(id);
  if (!cfg) return null;

  const bot = inst?.bot;
  const online = !!(bot && bot.entity);

  const obs: any = {
    bot: { id: cfg.id, username: cfg.username, host: cfg.host, online },
    self: null,
    inventory: [],
    inventorySlots: { total: 36, empty: 36, used: 0 },
    nearbyPlayers: [],
    nearbyEntities: [],
    recentChat: botManager.getRecentChat(id).slice(-20),
    recentOps: botManager.getRecentOps(id).slice(-20),
    modules: inst
      ? {
          combat: !!inst.combatConfig?.enabled,
          fishing: !!inst.fishingActive,
          automine: !!inst.autoMineTask?.active,
          autofarm: !!inst.farmTask?.active,
          mobhunter: !!inst.mobHunterTask?.active,
          runningScript: inst._runningScript?.name || (inst._customJs ? `JS:${inst._customJs.name}` : null),
        }
      : {},
    savedLocations: inst?.savedLocations || cfg.settings?.savedLocations || [],
  };

  if (!online) return obs;

  const pos = bot.entity.position;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const floorPos = (p: any) => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });

  const slots = bot.inventory?.slots || [];
  const maxHp = maxHealthOf(bot);
  const vel = bot.entity.velocity;

  const blocks = blockScan(bot);

  obs.self = {
    pos: floorPos(pos),
    health: Math.round(bot.health),
    maxHealth: maxHp,
    healthPct: maxHp > 0 ? Math.round((bot.health / maxHp) * 100) : null,
    food: Math.round(bot.food),
    foodSaturation: Math.round(bot.foodSaturation ?? 0),
    oxygen: typeof bot.oxygenLevel === "number" && bot.oxygenLevel < 20 ? bot.oxygenLevel : null,
    xpLevel: bot.experience?.level ?? 0,
    xpProgress: Math.round((bot.experience?.progress ?? 0) * 100),
    ping: typeof bot.player?.ping === "number" ? bot.player.ping : null,
    heldItem: bot.heldItem?.name ?? null,
    equipment: {
      mainHand: itemBrief(bot.heldItem),
      offHand: itemBrief(slots[45]),
      head: itemBrief(slots[5]),
      chest: itemBrief(slots[6]),
      legs: itemBrief(slots[7]),
      feet: itemBrief(slots[8]),
    },
    equipmentDurability: {
      mainHand: durabilityPct(bot.heldItem),
      offHand: durabilityPct(slots[45]),
      head: durabilityPct(slots[5]),
      chest: durabilityPct(slots[6]),
      legs: durabilityPct(slots[7]),
      feet: durabilityPct(slots[8]),
    },
    effects: effectsOf(bot, inst?.getMcData?.() ?? null),
    facing: facingOf(bot.entity.yaw ?? 0),
    yaw: r1(bot.entity.yaw ?? 0),
    pitch: r1(bot.entity.pitch ?? 0),
    onGround: !!bot.entity.onGround,
    inWater: !!bot.entity.isInWater,
    moving: vel ? Math.abs(vel.x) + Math.abs(vel.z) > 0.05 : false,
    vehicle: bot.vehicle ? bot.vehicle.name || bot.vehicle.displayName || "riding" : null,
    dimension: bot.game?.dimension ?? null,
    gameMode: bot.game?.gameMode ?? null,
    blocks,
  };

  try {
    const invItems = bot.inventory.items();
    obs.inventory = invItems.map((it: any) => ({
      slot: it.slot,
      name: it.name,
      count: it.count,
      displayName: it.displayName,
      enchants: enchantNames(it),
      durabilityPct: durabilityPct(it),
    }));
    // slot 9-44 = main inventory (36 slots)
    const mainSlots = bot.inventory.slots.filter((_: any, i: number) => i >= 9 && i <= 44);
    const emptyCount = mainSlots.filter((s: any) => !s).length;
    obs.inventorySlots = { total: 36, empty: emptyCount, used: 36 - emptyCount };
  } catch {
    /* ignore */
  }

  try {
    const ents = Object.values(bot.entities || {});
    const others: any[] = [];
    const holograms: any[] = [];
    for (const e of ents as any[]) {
      if (!e || !e.position || e === bot.entity) continue;
      const d = e.position.distanceTo(pos);
      if (d > 48) continue;
      const custom = entityCustomName(e);
      const hp = entityHealth(bot, e);
      const maxHp2 = entityMaxHealth(e);
      const item = {
        type: e.type,
        id: e.name || null,
        name:
          custom ||
          (typeof e.displayName === "string" ? e.displayName : null) ||
          e.name ||
          e.kind ||
          "unknown",
        custom: !!custom,
        category: e.kind || null,
        hostile: isHostile(e.kind),
        health: hp != null ? Math.round(hp) : null,
        maxHealth: maxHp2 != null ? Math.round(maxHp2) : null,
        distance: r1(d),
        pos: floorPos(e.position),
      };
      if (e.type === "player" && e.username && e.username !== bot.username) {
        const realPlayer = !!(bot.players && bot.players[e.username]);
        const cleanU = String(e.username).replace(/§./gi, "");
        const pd = txt(e.displayName);
        const npcCustom = entityCustomName(e);
        const isCitId = /^cit-[0-9a-f]+$/i.test(cleanU);
        let name = cleanU || e.username;
        let display: string | undefined = e.username !== cleanU ? e.username : pd && pd !== cleanU ? pd : undefined;
        if (isCitId) {
          name = npcCustom || (pd && pd !== cleanU ? pd : "") || "NPC";
          display = undefined;
        } else if (npcCustom && npcCustom !== cleanU) {
          name = npcCustom;
        }
        obs.nearbyPlayers.push({
          name,
          display,
          realPlayer,
          health: item.health,
          maxHealth: item.maxHealth,
          distance: item.distance,
          pos: item.pos,
        });
      } else if (e.type !== "object" && e.type !== "orb" && e.type !== "other") {
        // 盔甲架特殊处理：RPG 服用隐形盔甲架当全息字/名牌。带名字的归入 holograms
        // （文字情报，不是生物）；没名字的纯支架直接丢弃。绝不进 nearbyEntities。
        if (e.name === "armor_stand" || /armor.?stand/i.test(String(e.name || e.kind || ""))) {
          if (custom) holograms.push({ text: custom, distance: r1(d), pos: floorPos(e.position) });
          continue;
        }
        others.push(item);
      }
    }
    others.sort((a, b) => a.distance - b.distance);
    obs.nearbyEntities = others.slice(0, 20);
    holograms.sort((a, b) => a.distance - b.distance);
    obs.holograms = holograms.slice(0, 12);

    // 附近告示牌：16 格内扫 sign 方块读文字（路牌/规则牌/传送说明是 RPG 服的重要信息源）
    try {
      const signPosList = bot.findBlocks({
        matching: (b: any) => /sign/i.test(String(b?.name || "")),
        maxDistance: 16,
        count: 10,
      });
      const signs: any[] = [];
      for (const sp of signPosList) {
        const blk = bot.blockAt(sp);
        const text = signTextOf(blk);
        if (text) signs.push({ text, distance: r1(sp.distanceTo(pos)), pos: floorPos(sp) });
      }
      signs.sort((a, b) => a.distance - b.distance);
      obs.signs = signs.slice(0, 8);
    } catch {
      obs.signs = [];
    }
    obs.nearbyPlayers.sort((a: any, b: any) => a.distance - b.distance);

    const hostiles = others.filter((o) => o.hostile);
    obs.threats = {
      hostileCount: hostiles.length,
      nearest: hostiles[0] ? { name: hostiles[0].name, distance: hostiles[0].distance } : null,
    };
  } catch {
    /* ignore */
  }

  try {
    const sb = inst.getScoreboard?.();
    if (sb && (sb.items?.length || sb.sidebar?.length)) obs.scoreboard = sb;
  } catch {
    /* ignore */
  }

  try {
    const tl = bot.tablist || {};
    const bars = Object.values(bot.bossBars || {})
      .map((b: any) => ({
        title: txtC(b?.title),
        progress: typeof b?.health === "number" ? b.health : typeof b?.progress === "number" ? b.progress : null,
      }))
      .filter((b: any) => b.title);
    const ab = inst._actionBar && Date.now() - inst._actionBar.at < 15000 ? inst._actionBar.text : null;
    obs.serverText = {
      world: bot.game?.dimension ?? null,
      tablistHeader: txtC(tl.header),
      tablistFooter: txtC(tl.footer),
      bossBars: bars,
      actionBar: ab || null,
    };
  } catch {
    /* ignore */
  }

  try {
    obs.playersDisplay = Object.values(bot.players || {})
      .map((p: any) => ({ name: p?.username, display: txtC(p?.displayName) }))
      .filter((p: any) => p.name && p.display && p.display !== p.name)
      .slice(0, 12);
  } catch {
    /* ignore */
  }

  try {
    obs.environment = {
      timeOfDay: dayPhase(bot.time?.timeOfDay),
      isDay: !!bot.time?.isDay,
      raining: !!bot.isRaining,
      thundering: (bot.thunderState ?? 0) > 0,
    };
  } catch {
    /* ignore */
  }

  // 一句话情景摘要——服务器友好口径：RPG 服的真实状态（血量/魔法/等级/金币）在
  // actionbar/计分板/Boss栏里，手持武器常是改了名的原版物品（stick 可能是把神器）。
  // 原版生命/饱食保留作兜底，但不再是唯一口径。
  try {
    const s = obs.self;
    const env = obs.environment;
    const t = obs.threats;
    const bl = s.blocks;
    const clip = (v: any, n: number) => {
      const str = String(v ?? "").replace(/\s+/g, " ").trim();
      return str.length > n ? str.slice(0, n) + "…" : str;
    };
    // 手持：优先自定义名；确为改名物品时括注原版 id 便于对照（Stick→stick 这类大小写差异不算改名）
    const mh = s.equipment?.mainHand;
    const isRenamed = mh?.name && mh?.id && mh.name.toLowerCase().replace(/ /g, "_") !== String(mh.id).toLowerCase();
    const held = mh ? `手持${isRenamed ? `${clip(mh.name, 24)}(${mh.id})` : mh.name || mh.id}` : "";
    // 服务器 HUD：actionbar 通常承载 RPG 血条/魔法/冷却，Boss栏常是活动/世界 Boss 公告
    const st = obs.serverText || {};
    const hud = st.actionBar ? `HUD:${clip(st.actionBar, 48)}` : "";
    const boss =
      Array.isArray(st.bossBars) && st.bossBars.length
        ? `Boss栏:${clip(st.bossBars.map((b: any) => b.title).filter(Boolean).join("/"), 40)}`
        : "";
    // 计分板侧栏：等级/金币/职业等服务器自报状态（取前 4 行有效内容）。
    // 纯装饰行（一一一/====/───── 这类同字符重复的分隔线）不进摘要，省下篇幅给真数据。
    const isDeco = (txt: string) => {
      const t = txt.replace(/\s/g, "");
      return t.length >= 4 && new Set(t).size === 1;
    };
    const sbRows = obs.scoreboard?.sidebar;
    const sb =
      Array.isArray(sbRows) && sbRows.length
        ? `计分板:${clip(
            sbRows
              .map((r: any) => String(r.name || "").trim())
              .filter((n: string) => n && !isDeco(n))
              .slice(0, 4)
              .join(" "),
            56,
          )}`
        : "";
    obs.summary = [
      env ? `${env.timeOfDay}${env.raining ? "·雨" : ""}` : "",
      `生命${s.healthPct ?? "?"}% 饱食${s.food}`,
      hud,
      s.effects?.length ? `效果:${s.effects.map((e: any) => `${e.name}${e.level}`).join(",")}` : "",
      t?.hostileCount
        ? `敌对${t.hostileCount}${t.nearest ? `(最近${t.nearest.name} ${t.nearest.distance}m)` : ""}`
        : "无敌对",
      obs.nearbyPlayers.length ? `玩家${obs.nearbyPlayers.length}` : "",
      held,
      bl ? `脚下${bl.below}` : "",
      `背包${obs.inventorySlots.used}/${obs.inventorySlots.total}`,
      sb,
      boss,
    ]
      .filter(Boolean)
      .join(" | ");
  } catch {
    /* ignore */
  }

  return obs;
}
