import { useEffect, useState, type ReactNode, type ComponentType } from "react";
import {
  Heart,
  Drumstick,
  Star,
  Globe2,
  MapPin,
  Users,
  Activity,
  Coffee,
  Swords,
  Fish,
  Pickaxe,
  Wheat,
  Crosshair,
  Trash2,
  FileCode2,
  Clock,
  User,
  Bot,
  Skull,
  Store,
  PawPrint,
  Circle,
  SlidersHorizontal,
} from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { loadOverviewPrefs, saveOverviewPrefs, OVERVIEW_CARDS } from "@/lib/overviewPrefs";
import { cmd } from "@/lib/engine";
import { usePageVisible } from "@/lib/usePageVisible";
import McText from "@/components/McText";
import { cnMob } from "@/lib/mobNames";
import { classifyNearby, KIND_ORDER, KIND_LABEL, KIND_COLOR, type NearbyKind } from "@/lib/entityKind";
import { healthBar, healthTone, fmtUptime, fmtBig } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { BotSummary, Observation } from "@mcbot/protocol";

// 活动进度文案（取自各模块 stats）
const fmtMine = (s: any) => (s ? `已挖 ${s.total ?? 0}${s.rate != null ? ` · ${s.rate}/分` : ""}` : "搜索矿物中…");
const fmtFarm = (s: any) => (s ? `收割 ${s.totalHarvested ?? 0} · 种植 ${s.totalPlanted ?? 0}` : "巡查农田中…");
const fmtHunter = (s: any) =>
  s
    ? s.isPaused
      ? "已暂停 · 检测到玩家"
      : `击杀 ${s.totalKills ?? 0}${s.currentTarget ? ` · 目标 ${s.currentTarget}` : ""}`
    : "搜寻怪物中…";

// UIFEAT-5：这些列表周期性重取（玩家/计分板/bossBar/最近动态），用数组下标当 key 会在重排时
// 把 DOM/非受控态串到错行。改用内容做稳定 key；同内容多行时附加出现次序后缀，保证唯一。
function stableKeys<T>(items: T[], idOf: (item: T) => string): string[] {
  const seen = new Map<string, number>();
  return items.map((it) => {
    const base = idOf(it) || "·"; // 空文本兜底，避免空字符串键碰撞
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}#${n + 1}`;
  });
}

export default function OverviewTab({ bot }: { bot: BotSummary }) {
  const [obs, setObs] = useState<Observation | null>(null);
  const [stats, setStats] = useState<Record<string, any>>({});
  const [prefs, setPrefs] = useState(loadOverviewPrefs);
  const [cfgOpen, setCfgOpen] = useState(false);
  const show = (k: string) => !prefs.hidden[k];
  const updatePrefs = (p: typeof prefs) => {
    setPrefs(p);
    saveOverviewPrefs(p);
  };

  const m = bot.modules;

  // 实时感知 + 活动统计轮询
  const visible = usePageVisible();
  useEffect(() => {
    if (!bot.online) {
      setObs(null);
      setStats({});
      return;
    }
    if (!visible) return; // 页面后台：暂停拉取（恢复可见时 visible 变化触发重跑、立即拉一次）
    let cancelled = false;
    const poll = async () => {
      const r = await cmd.observe(bot.id);
      if (!cancelled && r.ok && r.data) setObs(r.data);
      const jobs: [string, string][] = [];
      if (m.automine) jobs.push(["automine", "automine"]);
      if (m.autofarm) jobs.push(["autofarm", "auto_farm"]);
      if (m.mobhunter) jobs.push(["mobhunter", "mob_hunter"]);
      // 攒一次 setStats：循环里逐个 set 各隔一个 await，React 18 不会合并成一次渲染
      const merged: Record<string, any> = {};
      for (const [k, mk] of jobs) {
        const s = await cmd.moduleAction(bot.id, mk, "stats");
        if (cancelled) return;
        if (s.ok && s.data) merged[k] = s.data;
      }
      if (Object.keys(merged).length) setStats((p) => ({ ...p, ...merged }));
    };
    poll();
    const t = setInterval(poll, Math.max(1, prefs.intervalSec) * 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // UIFEAT-4：只依赖 poll 实际读取的模块标志，去掉无关的 combat/fishing/trashcleaner（避免无谓重建 interval）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.id, bot.online, prefs.intervalSec, m.automine, m.autofarm, m.mobhunter, visible]);

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

  // 最近动态 = 机器人操作日志（动作/模块/脚本），不含服务器聊天
  const feed = (obs?.recentOps ?? [])
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(-8)
    .reverse();
  const feedKeys = stableKeys(feed, (line) => line); // 行文本做稳定 key（重复行加序号后缀）
  // 计分板行/ Boss 血条同样按内容生成稳定 key（无唯一 id，用文本+序号）
  const sbKeys = stableKeys(sbItems, (it) => String((it as any).raw || it.name || ""));
  const bossBarKeys = stableKeys(obs?.serverText?.bossBars ?? [], (b) => b.title || "boss");
  const playerDisplayKeys = stableKeys(obs?.playersDisplay ?? [], (p) => p.name); // 玩家名做稳定 key
  const hostileCount = (obs?.nearbyEntities ?? []).filter(
    (e) => classifyNearby({ id: (e as { id?: string }).id, name: e.name, hostile: e.hostile }) === "hostile",
  ).length;

  return (
    <div className="space-y-4">
      {/* 配置：哪些卡片显示 + 刷新间隔 */}
      <div className="flex justify-end">
        <button
          onClick={() => setCfgOpen((v) => !v)}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" /> 配置
        </button>
      </div>
      {cfgOpen && (
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">刷新间隔</span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={30}
                step={0.5}
                value={prefs.intervalSec}
                onChange={(e) =>
                  updatePrefs({ ...prefs, intervalSec: Math.min(30, Math.max(1, Number(e.target.value) || 3.5)) })
                }
                className="h-8 w-16 rounded-lg border border-border bg-surface px-2 text-sm"
              />
              <span className="text-xs text-muted">秒</span>
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted">显示的卡片（点亮=显示）</div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {OVERVIEW_CARDS.map((c) => {
                const on = !prefs.hidden[c.key];
                return (
                  <button
                    key={c.key}
                    onClick={() => updatePrefs({ ...prefs, hidden: { ...prefs.hidden, [c.key]: on } })}
                    className={cn(
                      "rounded-lg border px-2 py-1 text-xs transition-colors",
                      on ? "border-accent/40 bg-accent/10 text-accent" : "border-border text-muted hover:text-fg",
                    )}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* ===== 当前活动（核心） ===== */}
      {show("activity") && (
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
              {script && <ActivityRow icon={FileCode2} name={`脚本：${script}`} detail="运行中" highlight />}
            </div>
          )}
        </Card>
      )}

      {/* ===== 最近动态 ===== */}
      {show("feed") && (
        <Card className="p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">最近动态</h3>
          {feed.length === 0 ? (
            <p className="text-sm text-muted">暂无消息</p>
          ) : (
            <div className="space-y-1">
              {feed.map((line, i) => (
                <div key={feedKeys[i]} className="truncate text-[12px] leading-relaxed text-muted" title={line}>
                  {line}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ===== 状态磁贴 ===== */}
      {show("stats") && (
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
          <StatTile icon={<Clock className="h-4 w-4 text-success" />} label="在线时长" value={fmtUptime(bot.uptime)} />
        </div>
      )}

      {/* 位置 */}
      {show("pos") && (
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
      )}

      {/* 附近 */}
      {show("nearby") && (
        <Card className="p-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            <Users className="h-4 w-4 text-accent" /> 附近
            <span className="ml-1 text-xs font-normal text-muted">
              {obs?.nearbyPlayers?.length ?? 0} 玩家 · {obs?.nearbyEntities?.length ?? 0} 生物
              {hostileCount > 0 && <span className="ml-1 text-danger">· {hostileCount} 敌对</span>}
            </span>
          </h3>
          <NearbyList obs={obs} />
          {/* 全息字 / 告示牌：文字情报单列，不混进生物 */}
          {((obs?.holograms?.length ?? 0) > 0 || (obs?.signs?.length ?? 0) > 0) && (
            <div className="mt-3 space-y-2 border-t border-border/40 pt-2.5">
              {(obs?.holograms?.length ?? 0) > 0 && (
                <TextIntel title="全息字" items={obs!.holograms!} />
              )}
              {(obs?.signs?.length ?? 0) > 0 && (
                <TextIntel title="告示牌" items={obs!.signs!} />
              )}
            </div>
          )}
        </Card>
      )}

      {/* Boss 血条（独立一卡，有才显示） */}
      {show("boss") && obs?.serverText && obs.serverText.bossBars.length > 0 && (
        <Card className="p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <Swords className="h-4 w-4 text-danger" /> Boss 血条
          </h3>
          <div className="space-y-1.5">
            {obs.serverText.bossBars.map((b, i) => (
              <div key={bossBarKeys[i]}>
                <div className="flex justify-between text-xs">
                  <span className="truncate pr-2 font-medium">
                    <McText text={b.title || ""} />
                  </span>
                  {b.progress != null && <span className="text-muted">{Math.round(b.progress * 100)}%</span>}
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
        </Card>
      )}

      {/* Actionbar 已挪到「日志」页（和聊天并排显示），概览不再展示 */}

      {/* Tab 列表：表头/表尾 + 在线玩家展示名（含 PAPI 称号/颜色；有才显示） */}
      {show("tablist") &&
        obs?.serverText &&
        (obs.serverText.tablistHeader ||
          obs.serverText.tablistFooter ||
          (obs.playersDisplay?.length ?? 0) > 0) && (
          <Card className="p-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <Globe2 className="h-4 w-4 text-accent" /> Tab 列表
            </h3>
            {obs.serverText.tablistHeader && (
              <p className="whitespace-pre-line text-xs leading-relaxed text-muted">
                <McText text={obs.serverText.tablistHeader} />
              </p>
            )}
            {obs.serverText.tablistFooter && (
              <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-muted">
                <McText text={obs.serverText.tablistFooter} />
              </p>
            )}
            {(obs.playersDisplay?.length ?? 0) > 0 && (
              <div className="mt-2 border-t border-border pt-2">
                <div className="mb-1 flex items-center gap-1 text-[11px] text-muted">
                  <Users className="h-3 w-3" /> 在线玩家 · {obs.playersDisplay!.length}
                </div>
                <div className="flex flex-wrap gap-1">
                  {obs.playersDisplay!.map((p, i) => (
                    <span
                      key={playerDisplayKeys[i]}
                      className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px]"
                      title={p.name ?? undefined}
                    >
                      <McText text={p.display} />
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )}

      {/* 计分板（彩色还原；不强行分行/截断；分值为 0 的隐藏，避免噪声） */}
      {show("scoreboard") && sbItems.length > 0 && (
        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold">
            <McText text={sb?.sidebarTitleRaw || sb?.sidebarTitle || "计分板"} />
          </h3>
          <div className="space-y-0.5">
            {sbItems.map((it, i) => (
              <div key={sbKeys[i]} className="break-words text-[13px] leading-relaxed">
                <McText text={(it as any).raw || it.name || ""} />
              </div>
            ))}
          </div>
        </Card>
      )}
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

function NearbyRow({
  icon: Icon,
  iconClass,
  name,
  sub,
  distance,
  strong,
  nameClass,
  health,
  maxHealth,
}: {
  icon: ComponentType<{ className?: string }>;
  iconClass: string;
  name: ReactNode;
  sub?: string;
  distance: number;
  strong?: boolean;
  nameClass?: string;
  health?: number | null;
  maxHealth?: number | null;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-surface-2/40">
      <span className="flex min-w-0 items-center gap-1.5">
        <Icon className={cn("h-3.5 w-3.5 shrink-0", iconClass)} />
        <span className={cn("truncate", nameClass || (strong ? "font-medium" : "text-muted"))}>{name}</span>
        {sub && <span className="shrink-0 text-[11px] text-muted">{sub}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-xs tabular-nums">
        {typeof health === "number" && (
          <span className="flex items-center gap-0.5 text-rose-400" title={`血量 ${health}${typeof maxHealth === "number" ? "/" + maxHealth : ""}`}>
            <Heart className="h-3 w-3 fill-current" />
            {fmtBig(health)}
            {typeof maxHealth === "number" && maxHealth !== health && (
              <span className="text-muted">/{fmtBig(maxHealth)}</span>
            )}
          </span>
        )}
        <span className="text-muted">{distance}m</span>
      </span>
    </div>
  );
}

const KIND_ICON: Record<NearbyKind, ComponentType<{ className?: string }>> = {
  player: User,
  npc: Bot,
  villager: Store,
  hostile: Skull,
  animal: PawPrint,
  other: Circle,
};

type NearbyRowData = {
  key: string;
  nameNode: ReactNode;
  sub?: string;
  custom?: boolean;
  hostile?: boolean;
  health?: number | null;
  maxHealth?: number | null;
  distance: number;
};

/** 文字情报小节（全息字/告示牌）：一行一条，右侧距离 */
function TextIntel({ title, items }: { title: string; items: { text: string; distance: number }[] }) {
  return (
    <div>
      <div className="mb-0.5 text-[11px] font-semibold text-muted">
        {title} <span className="font-normal">· {items.length}</span>
      </div>
      <div className="space-y-0.5">
        {items.slice(0, 6).map((h, i) => (
          <div key={i} className="flex items-baseline justify-between gap-2 text-xs" title={h.text}>
            <span className="min-w-0 flex-1 truncate">
              <McText text={h.text} />
            </span>
            <span className="shrink-0 text-[10px] tabular-nums text-muted">{h.distance}格</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// 概览「附近」：按 玩家 / NPC / 村民 / 怪物 / 动物 / 其它 分组，每组带清晰小标题——一眼看清是什么。
function NearbyList({ obs }: { obs: Observation | null }) {
  const players = obs?.nearbyPlayers ?? [];
  const ents = obs?.nearbyEntities ?? [];
  if (players.length === 0 && ents.length === 0) {
    return <p className="text-sm text-muted">附近没有检测到玩家或生物</p>;
  }

  const groups: Record<NearbyKind, NearbyRowData[]> = {
    player: [], npc: [], villager: [], hostile: [], animal: [], other: [],
  };
  players.forEach((p, i) => {
    const kind = classifyNearby({ isPlayer: true, realPlayer: (p as { realPlayer?: boolean }).realPlayer });
    groups[kind].push({
      key: `p${i}`,
      nameNode: <McText text={p.display || p.name} />,
      sub: p.display && !p.display.includes("§") ? p.name : undefined,
      health: p.health,
      maxHealth: p.maxHealth,
      distance: p.distance,
      custom: true,
    });
  });
  ents.forEach((e, i) => {
    const id = (e as { id?: string }).id;
    const kind = classifyNearby({ id, name: e.name, hostile: e.hostile });
    groups[kind].push({
      key: `e${i}`,
      nameNode: <McText text={e.custom ? e.name : cnMob(id || e.name)} />,
      health: e.health,
      maxHealth: e.maxHealth,
      distance: e.distance,
      custom: e.custom,
      hostile: kind === "hostile",
    });
  });
  for (const k of KIND_ORDER) groups[k].sort((a, b) => a.distance - b.distance);

  return (
    <div className="space-y-2.5">
      {KIND_ORDER.filter((k) => groups[k].length > 0).map((k) => {
        const Icon = KIND_ICON[k];
        const rows = groups[k];
        const shown = rows.slice(0, 6);
        return (
          <div key={k}>
            <div className={cn("mb-0.5 flex items-center gap-1 text-[11px] font-semibold", KIND_COLOR[k])}>
              <Icon className="h-3 w-3" />
              {KIND_LABEL[k]}
              <span className="font-normal text-muted">· {rows.length}</span>
            </div>
            <div className="space-y-0.5">
              {shown.map((r) => (
                <NearbyRow
                  key={r.key}
                  icon={Icon}
                  iconClass={KIND_COLOR[k]}
                  name={r.nameNode}
                  sub={r.sub}
                  health={r.health}
                  maxHealth={r.maxHealth}
                  distance={r.distance}
                  strong={r.custom}
                  nameClass={r.hostile ? "font-medium text-danger" : undefined}
                />
              ))}
              {rows.length > shown.length && (
                <div className="px-1.5 text-[11px] text-muted">+{rows.length - shown.length} 更多</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
