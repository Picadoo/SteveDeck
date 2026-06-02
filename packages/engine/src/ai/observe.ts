import { botManager } from "../botManager";

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
    recentChat: botManager.getRecentLogs(id).slice(-20),
    modules: inst
      ? {
          combat: !!inst.combatConfig?.enabled,
          fishing: !!inst.fishingActive,
          automine: !!inst.autoMineTask?.active,
          autofarm: !!inst.farmTask?.active,
          mobhunter: !!inst.mobHunterTask?.active,
          runningScript: inst._runningScript?.name || null,
        }
      : {},
    savedLocations: inst?.savedLocations || cfg.settings?.savedLocations || [],
  };

  if (!online) return obs;

  const pos = bot.entity.position;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const floorPos = (p: any) => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });

  obs.self = {
    pos: floorPos(pos),
    health: Math.round(bot.health),
    food: Math.round(bot.food),
    xpLevel: bot.experience?.level ?? 0,
    heldItem: bot.heldItem?.name ?? null,
    yaw: r1(bot.entity.yaw ?? 0),
    pitch: r1(bot.entity.pitch ?? 0),
    dimension: bot.game?.dimension ?? null,
    gameMode: bot.game?.gameMode ?? null,
  };

  try {
    obs.inventory = bot.inventory.items().map((it: any) => ({
      name: it.name,
      count: it.count,
      displayName: it.displayName,
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
      const item = {
        type: e.type,
        name: e.name || e.username || e.displayName || e.kind || "unknown",
        distance: r1(d),
        pos: floorPos(e.position),
      };
      if (e.type === "player" && e.username && e.username !== bot.username) {
        obs.nearbyPlayers.push({ name: e.username, distance: item.distance, pos: item.pos });
      } else if (e.type !== "object" && e.type !== "orb" && e.type !== "other") {
        others.push(item);
      }
    }
    others.sort((a, b) => a.distance - b.distance);
    obs.nearbyEntities = others.slice(0, 20);
    obs.nearbyPlayers.sort((a: any, b: any) => a.distance - b.distance);
  } catch {
    /* ignore */
  }

  try {
    const sb = inst.getScoreboard?.();
    if (sb && (sb.items?.length || sb.sidebar?.length)) obs.scoreboard = sb;
  } catch {
    /* ignore */
  }

  return obs;
}
