import { useEffect, useState, type ReactNode, type ComponentType } from "react";
import {
  Heart,
  Drumstick,
  Star,
  Globe2,
  MapPin,
  Shield,
  Users,
  Search,
  RefreshCw,
  Activity,
  Coffee,
  Swords,
  Fish,
  Pickaxe,
  Wheat,
  Crosshair,
  Trash2,
  FileCode2,
} from "lucide-react";
import { Card, Button, Input, Badge } from "@/components/ui/primitives";
import { cmd } from "@/lib/engine";
import { useStore } from "@/store/useStore";
import { healthBar, healthTone } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { BotSummary, Observation, EquipItem } from "@mcbot/protocol";

const DIM_CN: Record<string, string> = {
  overworld: "主世界",
  the_nether: "下界",
  the_end: "末路之地",
  nether: "下界",
  end: "末路之地",
};
const MODE_CN: Record<string, string> = {
  survival: "生存",
  creative: "创造",
  adventure: "冒险",
  spectator: "旁观",
};

// 常见生物中文名（仅用于无自定义名牌时的友好回退）
const MOB_CN: Record<string, string> = {
  zombie: "僵尸",
  skeleton: "骷髅",
  creeper: "苦力怕",
  spider: "蜘蛛",
  cave_spider: "洞穴蜘蛛",
  enderman: "末影人",
  witch: "女巫",
  slime: "史莱姆",
  cow: "牛",
  pig: "猪",
  sheep: "羊",
  chicken: "鸡",
  villager: "村民",
  squid: "鱿鱼",
  bat: "蝙蝠",
  horse: "马",
  wolf: "狼",
  zombie_villager: "僵尸村民",
  husk: "尸壳",
  stray: "流浪者",
  drowned: "溺尸",
  blaze: "烈焰人",
  ghast: "恶魂",
  magma_cube: "岩浆怪",
  wither_skeleton: "凋灵骷髅",
  phantom: "幻翼",
  rabbit: "兔子",
  iron_golem: "铁傀儡",
};

type EquipKey = "head" | "chest" | "legs" | "feet" | "mainHand" | "offHand";
const EQUIP_SLOTS: { key: EquipKey; label: string }[] = [
  { key: "head", label: "头盔" },
  { key: "chest", label: "胸甲" },
  { key: "legs", label: "护腿" },
  { key: "feet", label: "靴子" },
  { key: "mainHand", label: "主手" },
  { key: "offHand", label: "副手" },
];

// 活动进度文案（取自各模块 stats）
const fmtMine = (s: any) => (s ? `已挖 ${s.total ?? 0}${s.rate != null ? ` · ${s.rate}/分` : ""}` : "搜索矿物中…");
const fmtFarm = (s: any) => (s ? `收割 ${s.totalHarvested ?? 0} · 种植 ${s.totalPlanted ?? 0}` : "巡查农田中…");
const fmtHunter = (s: any) =>
  s
    ? s.isPaused
      ? "已暂停 · 检测到玩家"
      : `击杀 ${s.totalKills ?? 0}${s.currentTarget ? ` · 目标 ${s.currentTarget}` : ""}`
    : "搜寻怪物中…";

export default function OverviewTab({ bot }: { bot: BotSummary }) {
  const pushToast = useStore((s) => s.pushToast);
  const [obs, setObs] = useState<Observation | null>(null);
  const [stats, setStats] = useState<Record<string, any>>({});
  const [npcName, setNpcName] = useState("");

  const m = bot.modules;

  // 实时感知 + 活动统计轮询
  useEffect(() => {
    if (!bot.online) {
      setObs(null);
      setStats({});
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const r = await cmd.observe(bot.id);
      if (!cancelled && r.ok && r.data) setObs(r.data);
      const jobs: [string, string][] = [];
      if (m.automine) jobs.push(["automine", "automine"]);
      if (m.autofarm) jobs.push(["autofarm", "auto_farm"]);
      if (m.mobhunter) jobs.push(["mobhunter", "mob_hunter"]);
      for (const [k, mk] of jobs) {
        const s = await cmd.moduleAction(bot.id, mk, "stats");
        if (!cancelled && s.ok && s.data) setStats((p) => ({ ...p, [k]: s.data }));
      }
    };
    poll();
    const t = setInterval(poll, 3500);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.id, bot.online, m.combat, m.fishing, m.automine, m.autofarm, m.mobhunter, m.trashcleaner]);

  if (!bot.online) {
    return (
      <div className="flex flex-col items-center py-16 text-muted">
        <Activity className="mb-2 h-8 w-8 opacity-40" />
        <p className="text-sm">机器人离线 — 上线后这里显示它正在做什么</p>
      </div>
    );
  }

  // 当前在运行的自动化
  const acts: { icon: ComponentType<{ className?: string }>; name: string; detail: string }[] = [];
  if (m.combat) acts.push({ icon: Swords, name: "自动战斗", detail: "攻击附近敌对目标" });
  if (m.fishing) acts.push({ icon: Fish, name: "自动钓鱼", detail: "自动抛竿 / 收竿" });
  if (m.automine) acts.push({ icon: Pickaxe, name: "自动挖矿", detail: fmtMine(stats.automine) });
  if (m.autofarm) acts.push({ icon: Wheat, name: "自动农场", detail: fmtFarm(stats.autofarm) });
  if (m.mobhunter) acts.push({ icon: Crosshair, name: "追怪系统", detail: fmtHunter(stats.mobhunter) });
  if (m.trashcleaner) acts.push({ icon: Trash2, name: "垃圾清理", detail: "自动丢弃垃圾物品" });
  const script = m.script;
  const idle = acts.length === 0 && !script;

  const self = obs?.self;
  const max = self?.maxHealth && self.maxHealth > 0 ? self.maxHealth : 20;
  const hp = self?.health ?? bot.health ?? 0;
  const pct = Math.max(0, Math.min(100, Math.round((hp / max) * 100)));
  const foodPct = Math.round(((self?.food ?? bot.food ?? 0) / 20) * 100);
  const sb: any = obs?.scoreboard;
  const sbItems: { name: string; value: number | string }[] = sb?.items || sb?.sidebar || [];

  const feed = (obs?.recentChat ?? [])
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l && !/Sweep in \d+ second/i.test(l))
    .slice(-6)
    .reverse();

  return (
    <div className="space-y-4">
      {/* ===== 当前活动（核心） ===== */}
      <Card className="p-4">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
          <Activity className="h-4 w-4 text-accent" /> 当前活动
        </h3>
        {idle ? (
          <div className="flex items-center gap-2.5 rounded-lg bg-surface-2/50 px-3 py-3 text-muted">
            <Coffee className="h-5 w-5 shrink-0" />
            <div>
              <div className="text-sm font-medium text-fg">空闲待命</div>
              <div className="text-[11px]">未运行任何自动化模块或脚本</div>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {acts.map((a) => (
              <ActivityRow key={a.name} icon={a.icon} name={a.name} detail={a.detail} />
            ))}
            {script && (
              <ActivityRow icon={FileCode2} name={`脚本：${script}`} detail="运行中" highlight />
            )}
          </div>
        )}
      </Card>

      {/* ===== 最近动态 ===== */}
      <Card className="p-4">
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">最近动态</h3>
        {feed.length === 0 ? (
          <p className="text-sm text-muted">暂无消息</p>
        ) : (
          <div className="space-y-1">
            {feed.map((line, i) => (
              <div key={i} className="truncate text-[12px] leading-relaxed text-muted" title={line}>
                {line}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ===== 状态磁贴 ===== */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatTile
          icon={<Heart className={cn("h-4 w-4", healthTone(pct))} />}
          label="生命"
          value={`${pct}%`}
          sub={`${hp}/${max}`}
          bar={pct}
          barClass={healthBar(pct)}
        />
        <StatTile
          icon={<Drumstick className="h-4 w-4 text-warning" />}
          label="饱食"
          value={`${self?.food ?? bot.food ?? "-"}`}
          sub={`${foodPct}%`}
          bar={foodPct}
          barClass="bg-warning"
        />
        <StatTile
          icon={<Star className="h-4 w-4 text-accent" />}
          label="经验等级"
          value={`${self?.xpLevel ?? bot.level ?? 0}`}
        />
        <StatTile
          icon={<Globe2 className="h-4 w-4 text-success" />}
          label="维度"
          value={DIM_CN[self?.dimension ?? ""] ?? self?.dimension ?? "—"}
          sub={MODE_CN[self?.gameMode ?? ""] ?? self?.gameMode ?? undefined}
        />
      </div>

      {/* 位置 */}
      <Card className="flex items-center gap-2 p-3 text-sm">
        <MapPin className="h-4 w-4 shrink-0 text-success" />
        <span className="text-muted">坐标</span>
        <span className="font-mono font-medium">
          {self?.pos
            ? `${self.pos.x}, ${self.pos.y}, ${self.pos.z}`
            : bot.pos
              ? `${bot.pos.x}, ${bot.pos.y}, ${bot.pos.z}`
              : "—"}
        </span>
      </Card>

      {/* 装备 */}
      <Card className="p-4">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
          <Shield className="h-4 w-4 text-accent" /> 装备
        </h3>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {EQUIP_SLOTS.map(({ key, label }) => (
            <EquipRow key={key} label={label} item={self?.equipment?.[key] ?? null} />
          ))}
        </div>
      </Card>

      {/* 附近 */}
      <Card className="p-4">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
          <Users className="h-4 w-4 text-accent" /> 附近
          <span className="ml-1 text-xs font-normal text-muted">
            {obs?.nearbyPlayers?.length ?? 0} 玩家 · {obs?.nearbyEntities?.length ?? 0} 生物
          </span>
        </h3>
        <NearbyList obs={obs} />
      </Card>

      {/* 服务器信息：Tab 头尾 / Boss 条（PAPI 渲染处，有才显示） */}
      {obs?.serverText &&
        (obs.serverText.tablistHeader ||
          obs.serverText.tablistFooter ||
          obs.serverText.bossBars.length > 0) && (
          <Card className="p-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <Globe2 className="h-4 w-4 text-accent" /> 服务器信息
            </h3>
            {obs.serverText.bossBars.length > 0 && (
              <div className="mb-2 space-y-1.5">
                {obs.serverText.bossBars.map((b, i) => (
                  <div key={i}>
                    <div className="flex justify-between text-xs">
                      <span className="truncate pr-2 font-medium">{b.title}</span>
                      {b.progress != null && (
                        <span className="text-muted">{Math.round(b.progress * 100)}%</span>
                      )}
                    </div>
                    {b.progress != null && (
                      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="h-full rounded-full bg-danger"
                          style={{ width: `${Math.round(b.progress * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {obs.serverText.tablistHeader && (
              <p className="whitespace-pre-line text-xs leading-relaxed text-muted">
                {obs.serverText.tablistHeader}
              </p>
            )}
            {obs.serverText.tablistFooter && (
              <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-muted">
                {obs.serverText.tablistFooter}
              </p>
            )}
          </Card>
        )}

      {/* 计分板 */}
      {sbItems.length > 0 && (
        <Card className="p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">{sb?.title || "计分板"}</h3>
          <div className="space-y-1">
            {sbItems.map((it, i) => (
              <div key={i} className="flex justify-between border-b border-border/40 py-1 text-sm last:border-0">
                <span className="truncate pr-2 text-muted">{it.name}</span>
                <span className="font-medium tabular-nums">{it.value}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* NPC 交互 */}
      <Card className="p-4">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
          <Search className="h-4 w-4 text-accent" /> NPC 交互
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => cmd.moduleAction(bot.id, "npc", "scan")}>
            <Search className="h-3.5 w-3.5" /> 扫描附近 NPC
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              const r = await cmd.moduleAction(bot.id, "scoreboard", "get");
              if (!r.ok) pushToast(r.error || "获取计分板失败", "error");
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" /> 刷新计分板
          </Button>
        </div>
        <div className="mt-2 flex gap-2">
          <Input value={npcName} onChange={(e) => setNpcName(e.target.value)} placeholder="NPC 名称" />
          <Button
            size="sm"
            variant="primary"
            disabled={!npcName.trim()}
            onClick={() => cmd.moduleAction(bot.id, "npc", "interact", { name: npcName.trim() })}
          >
            交互
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted">扫描结果见「日志」标签</p>
      </Card>
    </div>
  );
}

function ActivityRow({
  icon: Icon,
  name,
  detail,
  highlight,
}: {
  icon: ComponentType<{ className?: string }>;
  name: string;
  detail: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-3 py-2.5",
        highlight ? "bg-accent/10" : "bg-surface-2/60",
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{name}</div>
        <div className="truncate text-[11px] text-muted">{detail}</div>
      </div>
      <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-success" title="运行中" />
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  sub,
  bar,
  barClass,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: string;
  bar?: number;
  barClass?: string;
}) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted">
        {icon}
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-xl font-semibold leading-none">{value}</span>
        {sub && <span className="text-[11px] text-muted">{sub}</span>}
      </div>
      {typeof bar === "number" && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className={cn("h-full rounded-full transition-all", barClass)} style={{ width: `${bar}%` }} />
        </div>
      )}
    </Card>
  );
}

function EquipRow({ label, item }: { label: string; item: EquipItem | null }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface-2/50 px-2.5 py-1.5">
      <span className="w-9 shrink-0 text-[11px] text-muted">{label}</span>
      {item ? (
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{item.name}</span>
            {item.count > 1 && <span className="text-[11px] text-muted">×{item.count}</span>}
          </div>
          {item.enchants && item.enchants.length > 0 && (
            <div className="mt-0.5 flex flex-wrap gap-1">
              {item.enchants.map((e, i) => (
                <span key={i} className="rounded bg-accent/12 px-1.5 py-px text-[10px] text-accent">
                  {e}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <span className="flex-1 text-sm text-muted/50">—</span>
      )}
    </div>
  );
}

function NearbyList({ obs }: { obs: Observation | null }) {
  const players = obs?.nearbyPlayers ?? [];
  // 命名生物（RPG Boss/宠物）排前面
  const ents = [...(obs?.nearbyEntities ?? [])].sort(
    (a, b) => Number(!!b.custom) - Number(!!a.custom) || a.distance - b.distance,
  );
  if (players.length === 0 && ents.length === 0) {
    return <p className="text-sm text-muted">附近没有检测到玩家或生物</p>;
  }
  return (
    <div className="space-y-1">
      {players.slice(0, 5).map((p, i) => (
        <div key={`p${i}`} className="flex items-center justify-between text-sm">
          <span className="flex min-w-0 items-center gap-1.5">
            <Badge tone="success">玩家</Badge>
            <span className="truncate font-medium">{p.display || p.name}</span>
            {p.display && <span className="shrink-0 text-[11px] text-muted">{p.name}</span>}
          </span>
          <span className="shrink-0 text-xs text-muted tabular-nums">{p.distance}m</span>
        </div>
      ))}
      {ents.slice(0, 8).map((e, i) => {
        const label = e.custom ? e.name : MOB_CN[e.name.toLowerCase()] || e.name;
        return (
          <div key={`e${i}`} className="flex items-center justify-between text-sm">
            <span className="flex min-w-0 items-center gap-1.5">
              {e.custom && <Badge tone="warning">命名</Badge>}
              <span className={cn("truncate", e.custom ? "font-medium" : "text-muted")}>{label}</span>
            </span>
            <span className="shrink-0 text-xs text-muted tabular-nums">{e.distance}m</span>
          </div>
        );
      })}
    </div>
  );
}
