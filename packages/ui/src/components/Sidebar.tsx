import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Plus, LogOut, Heart, Drumstick, Server, ChevronDown, Cpu, Users } from "lucide-react";
import { useStore } from "@/store/useStore";
import { StatusDot, IconButton, Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { disconnect } from "@/lib/engine";
import { usePageVisible } from "@/lib/usePageVisible";
import { healthPct, healthTone } from "@/lib/format";
import AddBotDialog from "@/features/bot/AddBotDialog";
import BatchAddDialog from "@/features/bot/BatchAddDialog";
import type { BotSummary } from "@mcbot/protocol";

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const bots = useStore((s) => s.bots);
  const selectedId = useStore((s) => s.selectedId);
  const setSelected = useStore((s) => s.setSelected);
  const conn = useStore((s) => s.conn);
  const [addOpen, setAddOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // 引擎进程资源占用（只看本软件，不看宿主机其他程序）：5s 轮询，页面后台暂停；旧引擎无端点则不显示
  const [engineStats, setEngineStats] = useState<{ cpuPct: number; rssMB: number } | null>(null);
  const visible = usePageVisible();
  useEffect(() => {
    if (conn.status !== "online" || !visible) return;
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch(`${conn.url.replace(/\/+$/, "")}/api/engine-stats`, {
          headers: { Authorization: `Bearer ${conn.token}` },
        });
        if (alive && r.ok) setEngineStats(await r.json());
      } catch {
        /* 引擎暂不可达：保留上次值 */
      }
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [conn.status, conn.url, conn.token, visible]);

  // 稳定引用：行内闭包会让 memo(BotRow) 永远不等价。
  // onNavigate 走 ref——调用方若传内联箭头（每渲染新引用），不至于击穿全部 BotRow 的 memo。
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const onSelect = useCallback(
    (id: string) => {
      setSelected(id);
      onNavigateRef.current?.();
    },
    [setSelected],
  );

  // 按服务器（host）分组；组内假人（lite）单独折叠——几十只假人不再撑爆列表
  const groups = useMemo(() => {
    const map = new Map<string, BotSummary[]>();
    for (const b of bots) {
      const arr = map.get(b.host) ?? [];
      arr.push(b);
      map.set(b.host, arr);
    }
    return Array.from(map.entries()).map(([host, list]) => {
      const real = list.filter((b) => !b.lite);
      const fake = list.filter((b) => b.lite);
      return {
        host,
        label: list.find((b) => b.note && !b.lite)?.note || list.find((b) => b.note)?.note || host,
        real,
        fake,
        fakeOnline: fake.filter((b) => b.online).length,
        online: list.filter((b) => b.online).length,
        total: list.length,
      };
    });
  }, [bots]);
  // 假人子组展开态（默认收起）；选中的假人所在组强制展开，避免「选了却看不见」
  const [fakeOpen, setFakeOpen] = useState<Record<string, boolean>>({});

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-surface">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3.5 drag-region">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <Bot className="h-4 w-4" />
          </div>
          <span className="text-sm font-semibold">机器人</span>
          <Badge tone="neutral">{bots.length}</Badge>
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton onClick={() => setBatchOpen(true)} title="批量假人（氛围组）">
            <Users className="h-4 w-4" />
          </IconButton>
          <IconButton onClick={() => setAddOpen(true)} title="添加机器人">
            <Plus className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      {/* 列表（按服务器分组） */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {bots.length === 0 ? (
          <div className="mt-10 px-4 text-center text-xs text-muted">
            还没有机器人
            <br />
            点击右上角 + 添加
          </div>
        ) : (
          <div className="space-y-2">
            {groups.map((g) => {
              const isCollapsed = collapsed[g.host];
              return (
                <div key={g.host}>
                  {/* 服务器分组头 */}
                  <button
                    onClick={() => setCollapsed((c) => ({ ...c, [g.host]: !c[g.host] }))}
                    className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] font-medium text-muted hover:text-fg"
                  >
                    <ChevronDown
                      className={cn("h-3 w-3 shrink-0 transition-transform", isCollapsed && "-rotate-90")}
                    />
                    <Server className="h-3 w-3 shrink-0 text-accent/70" />
                    <span className="min-w-0 flex-1 truncate" title={g.host}>
                      {g.label}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {g.online}/{g.total}
                    </span>
                  </button>

                  {!isCollapsed && (
                    <ul className="space-y-0.5">
                      {g.real.map((b) => (
                        <li key={b.id}>
                          <BotRow bot={b} active={b.id === selectedId} onSelect={onSelect} />
                        </li>
                      ))}
                      {g.fake.length > 0 && (() => {
                        const open = fakeOpen[g.host] || g.fake.some((b) => b.id === selectedId);
                        return (
                          <li>
                            <button
                              onClick={() => setFakeOpen((o) => ({ ...o, [g.host]: !open }))}
                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] text-muted transition-colors hover:bg-surface-2/60 hover:text-fg"
                              title="批量假人（氛围组），点击展开/收起"
                            >
                              <Users className="h-3.5 w-3.5 shrink-0 text-accent/60" />
                              <span className="min-w-0 flex-1 truncate">假人 ×{g.fake.length}</span>
                              <span className="shrink-0 tabular-nums">{g.fakeOnline} 在线</span>
                              <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", !open && "-rotate-90")} />
                            </button>
                            {open && (
                              <ul className="space-y-0.5 pl-2">
                                {g.fake.map((b) => (
                                  <li key={b.id}>
                                    <BotRow bot={b} active={b.id === selectedId} onSelect={onSelect} />
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        );
                      })()}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 底部：引擎信息 + 断开 */}
      <div className="border-t border-border px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[11px] font-medium text-fg">
              {conn.url.replace(/^https?:\/\//, "") || "—"}
            </div>
            <div className="text-[10px] text-muted">
              引擎 {conn.engine?.version ? `v${conn.engine.version}` : ""}
            </div>
            {engineStats && (
              <div className="flex items-center gap-1 text-[10px] tabular-nums text-muted" title="引擎进程自身占用（每 5 秒刷新）">
                <Cpu className="h-3 w-3" /> CPU {engineStats.cpuPct}% · 内存 {engineStats.rssMB}MB
              </div>
            )}
          </div>
          <IconButton onClick={() => disconnect()} title="断开连接">
            <LogOut className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      <AddBotDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <BatchAddDialog open={batchOpen} onClose={() => setBatchOpen(false)} />
    </aside>
  );
}

// memo：任一 bot 的状态推送只重渲它自己的行（upsertBot 对未变化 bot 保留旧引用 + 无变化短路）
const BotRow = memo(function BotRow({
  bot,
  active,
  onSelect,
}: {
  bot: BotSummary;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const pct = healthPct(bot);
  return (
    <button
      onClick={() => onSelect(bot.id)}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
        active ? "bg-surface-2" : "hover:bg-surface-2/60",
      )}
    >
      <StatusDot online={bot.online} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 truncate text-sm font-medium">
          <span className="truncate">{bot.username}</span>
          {bot.lite && (
            <span className="shrink-0 rounded bg-surface-2 px-1 text-[9px] font-normal text-muted" title="轻量假人（氛围组）">
              假
            </span>
          )}
        </div>
        <div className="truncate text-[11px] text-muted">
          {bot.online ? `等级 ${bot.level ?? 0}` : "离线"}
        </div>
      </div>
      {bot.online ? (
        <div className="flex flex-col items-end gap-0.5 text-[10px]">
          <span className={cn("flex items-center gap-0.5", healthTone(pct))}>
            <Heart className="h-3 w-3" /> {pct ?? "-"}%
          </span>
          <span className="flex items-center gap-0.5 text-muted">
            <Drumstick className="h-3 w-3 text-warning" /> {bot.food ?? "-"}
          </span>
        </div>
      ) : bot.reconnecting ? (
        <Badge tone="warning">重连中</Badge>
      ) : bot.fatalReason ? (
        <Badge tone="danger">离线</Badge>
      ) : (
        <Badge tone="neutral">离线</Badge>
      )}
    </button>
  );
});
