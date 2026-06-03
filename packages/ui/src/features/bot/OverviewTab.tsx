import { useEffect, useState, type ReactNode } from "react";
import {
  Heart,
  Drumstick,
  Star,
  Globe2,
  MapPin,
  Shield,
  Swords,
  Users,
  Search,
  RefreshCw,
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

type EquipKey = "head" | "chest" | "legs" | "feet" | "mainHand" | "offHand";
const EQUIP_SLOTS: { key: EquipKey; label: string }[] = [
  { key: "head", label: "头盔" },
  { key: "chest", label: "胸甲" },
  { key: "legs", label: "护腿" },
  { key: "feet", label: "靴子" },
  { key: "mainHand", label: "主手" },
  { key: "offHand", label: "副手" },
];

export default function OverviewTab({ bot }: { bot: BotSummary }) {
  const pushToast = useStore((s) => s.pushToast);
  const [obs, setObs] = useState<Observation | null>(null);
  const [npcName, setNpcName] = useState("");

  // 实时感知轮询
  useEffect(() => {
    if (!bot.online) {
      setObs(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const r = await cmd.observe(bot.id);
      if (!cancelled && r.ok && r.data) setObs(r.data);
    };
    poll();
    const t = setInterval(poll, 3500);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [bot.id, bot.online]);

  if (!bot.online) {
    return (
      <div className="flex flex-col items-center py-16 text-muted">
        <Globe2 className="mb-2 h-8 w-8 opacity-40" />
        <p className="text-sm">机器人离线 — 上线后这里显示实时状态</p>
      </div>
    );
  }

  const self = obs?.self;
  const max = self?.maxHealth && self.maxHealth > 0 ? self.maxHealth : 20;
  const hp = self?.health ?? bot.health ?? 0;
  const pct = Math.max(0, Math.min(100, Math.round((hp / max) * 100)));
  const foodPct = Math.round(((self?.food ?? bot.food ?? 0) / 20) * 100);
  const sb: any = obs?.scoreboard;
  const sbItems: { name: string; value: number | string }[] = sb?.items || sb?.sidebar || [];

  return (
    <div className="space-y-4">
      {/* 状态磁贴 */}
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
          {self?.pos ? `${self.pos.x}, ${self.pos.y}, ${self.pos.z}` : bot.pos ? `${bot.pos.x}, ${bot.pos.y}, ${bot.pos.z}` : "—"}
        </span>
      </Card>

      {/* 装备 */}
      <Card className="p-4">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
          <Shield className="h-4 w-4 text-accent" /> 装备
        </h3>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {EQUIP_SLOTS.map(({ key, label }) => (
            <EquipRow key={key as string} label={label} item={self?.equipment?.[key] ?? null} />
          ))}
        </div>
      </Card>

      {/* 附近 */}
      <Card className="p-4">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
          <Users className="h-4 w-4 text-accent" /> 附近
          <span className="ml-1 text-xs font-normal text-muted">
            {(obs?.nearbyPlayers?.length ?? 0)} 玩家 · {(obs?.nearbyEntities?.length ?? 0)} 生物
          </span>
        </h3>
        <NearbyList obs={obs} />
      </Card>

      {/* 计分板（RPG 服常用来显示金币/职业/任务） */}
      {sbItems.length > 0 && (
        <Card className="p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <Swords className="h-4 w-4 text-accent" /> {sb?.title || "计分板"}
          </h3>
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
  const ents = obs?.nearbyEntities ?? [];
  if (players.length === 0 && ents.length === 0) {
    return <p className="text-sm text-muted">附近没有检测到玩家或生物</p>;
  }
  return (
    <div className="space-y-1">
      {players.slice(0, 5).map((p, i) => (
        <div key={`p${i}`} className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-1.5">
            <Badge tone="success">玩家</Badge>
            <span className="font-medium">{p.name}</span>
          </span>
          <span className="text-xs text-muted tabular-nums">{p.distance}m</span>
        </div>
      ))}
      {ents.slice(0, 6).map((e, i) => (
        <div key={`e${i}`} className="flex items-center justify-between text-sm">
          <span className="truncate pr-2 text-muted">{e.name}</span>
          <span className="text-xs text-muted tabular-nums">{e.distance}m</span>
        </div>
      ))}
    </div>
  );
}
