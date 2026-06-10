import { memo, useCallback, useMemo, useRef, useState } from "react";
import { Bot, Plus, LogOut, Heart, Drumstick, Server, ChevronDown } from "lucide-react";
import { useStore } from "@/store/useStore";
import { StatusDot, IconButton, Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { disconnect } from "@/lib/engine";
import { healthPct, healthTone } from "@/lib/format";
import AddBotDialog from "@/features/bot/AddBotDialog";
import type { BotSummary } from "@mcbot/protocol";

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const bots = useStore((s) => s.bots);
  const selectedId = useStore((s) => s.selectedId);
  const setSelected = useStore((s) => s.setSelected);
  const conn = useStore((s) => s.conn);
  const [addOpen, setAddOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

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

  // 按服务器（host）分组
  const groups = useMemo(() => {
    const map = new Map<string, BotSummary[]>();
    for (const b of bots) {
      const arr = map.get(b.host) ?? [];
      arr.push(b);
      map.set(b.host, arr);
    }
    return Array.from(map.entries()).map(([host, list]) => ({
      host,
      label: list.find((b) => b.note)?.note || host,
      list,
      online: list.filter((b) => b.online).length,
    }));
  }, [bots]);

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
        <IconButton onClick={() => setAddOpen(true)} title="添加机器人">
          <Plus className="h-4 w-4" />
        </IconButton>
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
                      {g.online}/{g.list.length}
                    </span>
                  </button>

                  {!isCollapsed && (
                    <ul className="space-y-0.5">
                      {g.list.map((b) => (
                        <li key={b.id}>
                          <BotRow bot={b} active={b.id === selectedId} onSelect={onSelect} />
                        </li>
                      ))}
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
          </div>
          <IconButton onClick={() => disconnect()} title="断开连接">
            <LogOut className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      <AddBotDialog open={addOpen} onClose={() => setAddOpen(false)} />
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
        <div className="truncate text-sm font-medium">{bot.username}</div>
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
