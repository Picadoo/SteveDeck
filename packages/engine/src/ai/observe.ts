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
    if (typeof v === "string") return v.replace(/§[0-9a-fk-orx]/gi, "").trim() || null;
    if (typeof v.toString === "function") {
      const s = v.toString();
      if (typeof s === "string" && s !== "[object Object]")
        return s.replace(/§[0-9a-fk-orx]/gi, "").trim() || null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** 取实体的自定义名牌（去色码），无则 null */
function entityCustomName(e: any): string | null {
  return txt(e?.customName) || (e && typeof e.displayName === "object" ? txt(e.displayName) : null);
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
function effectsOf(bot: any): any[] {
  try {
    const eff = bot?.entity?.effects;
    if (!eff) return [];
    const mcData = require("minecraft-data")(bot.version);
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
  obs.self = {
    pos: floorPos(pos),
    health: Math.round(bot.health),
    maxHealth: maxHp,
    healthPct: maxHp > 0 ? Math.round((bot.health / maxHp) * 100) : null,
    food: Math.round(bot.food),
    foodSaturation: Math.round(bot.foodSaturation ?? 0),
    // 氧气仅在缺氧（潜水/憋气）时才有意义，满值不噪声
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
    effects: effectsOf(bot),
    facing: facingOf(bot.entity.yaw ?? 0),
    yaw: r1(bot.entity.yaw ?? 0),
    pitch: r1(bot.entity.pitch ?? 0),
    onGround: !!bot.entity.onGround,
    inWater: !!bot.entity.isInWater,
    moving: vel ? Math.abs(vel.x) + Math.abs(vel.z) > 0.05 : false,
    vehicle: bot.vehicle ? bot.vehicle.name || bot.vehicle.displayName || "riding" : null,
    dimension: bot.game?.dimension ?? null,
    gameMode: bot.game?.gameMode ?? null,
  };

  try {
    obs.inventory = bot.inventory.items().map((it: any) => ({
      name: it.name,
      count: it.count,
      displayName: it.displayName,
      enchants: enchantNames(it),
    }));
  } catch {
    /* ignore */
  }

  try {
    const ents = Object.values(bot.entities || {});
    const others: any[] = [];
    for (const e of ents as any[]) {
      if (!e || !e.position || e === bot.entity) continue;
      const d = e.position.distanceTo(pos);
      if (d > 48) continue;
      const custom = entityCustomName(e);
      const hp = entityHealth(bot, e);
      const maxHp2 = entityMaxHealth(e);
      const item = {
        type: e.type,
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
        // 真人 = 在线列表(tablist)里有该名字；玩家型 NPC(Citizens 等)通常不在
        const realPlayer = !!(bot.players && bot.players[e.username]);
        const cleanU = String(e.username).replace(/§[0-9a-fk-orx]/gi, "");
        const pd = txt(e.displayName);
        obs.nearbyPlayers.push({
          name: cleanU || e.username, // 纯文本名（NPC 的彩色名去码）
          // NPC 名常带 §颜色码，原文留给前端上色；否则用 PAPI 展示名（与原名不同才收）
          display: e.username !== cleanU ? e.username : pd && pd !== cleanU ? pd : undefined,
          realPlayer,
          health: item.health,
          maxHealth: item.maxHealth,
          distance: item.distance,
          pos: item.pos,
        });
      } else if (e.type !== "object" && e.type !== "orb" && e.type !== "other") {
        // 跳过无名牌的装饰盔甲架（服务器常用来做全息文字/NPC 底座，噪声大）
        if (!custom && (e.name === "armor_stand" || /armor.?stand/i.test(item.name))) continue;
        others.push(item);
      }
    }
    others.sort((a, b) => a.distance - b.distance);
    obs.nearbyEntities = others.slice(0, 20);
    obs.nearbyPlayers.sort((a: any, b: any) => a.distance - b.distance);

    // 威胁概览：附近敌对生物数量 + 最近的一只（AI 决策用）
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

  // 服务器渲染文本（PAPI 多输出到这些客户端可见处：Tab 头尾 / Boss 血条）
  try {
    const tl = bot.tablist || {};
    const bars = Object.values(bot.bossBars || {})
      .map((b: any) => ({
        title: txt(b?.title),
        progress: typeof b?.health === "number" ? b.health : typeof b?.progress === "number" ? b.progress : null,
      }))
      .filter((b: any) => b.title);
    obs.serverText = {
      world: bot.game?.dimension ?? null,
      tablistHeader: txt(tl.header),
      tablistFooter: txt(tl.footer),
      bossBars: bars,
    };
  } catch {
    /* ignore */
  }

  // 玩家 Tab 展示名（含 PAPI 前后缀，与原名不同才收录）
  try {
    obs.playersDisplay = Object.values(bot.players || {})
      .map((p: any) => ({ name: p?.username, display: txt(p?.displayName) }))
      .filter((p: any) => p.name && p.display && p.display !== p.name)
      .slice(0, 12);
  } catch {
    /* ignore */
  }

  // 环境（时间/天气）
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

  // 一句话情景摘要：供 AI 快速读取全局态势（不必逐字段解析）
  try {
    const s = obs.self;
    const env = obs.environment;
    const t = obs.threats;
    obs.summary = [
      env ? `${env.timeOfDay}${env.raining ? "·雨" : ""}` : "",
      `生命${s.healthPct ?? "?"}% 饱食${s.food}`,
      s.effects?.length ? `效果:${s.effects.map((e: any) => `${e.name}${e.level}`).join(",")}` : "",
      t?.hostileCount ? `敌对${t.hostileCount}(最近${t.nearest.name} ${t.nearest.distance}m)` : "无敌对",
      obs.nearbyPlayers.length ? `玩家${obs.nearbyPlayers.length}` : "",
      s.heldItem ? `手持${s.heldItem}` : "",
    ]
      .filter(Boolean)
      .join(" | ");
  } catch {
    /* ignore */
  }

  return obs;
}
