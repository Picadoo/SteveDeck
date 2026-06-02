import { useState } from "react";
import { Bot, Plus, LogOut, Heart, Drumstick } from "lucide-react";
import { useStore } from "@/store/useStore";
import { StatusDot, IconButton, Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { disconnect } from "@/lib/engine";
import AddBotDialog from "@/features/bot/AddBotDialog";

export default function Sidebar() {
  const bots = useStore((s) => s.bots);
  const selectedId = useStore((s) => s.selectedId);
  const setSelected = useStore((s) => s.setSelected);
  const conn = useStore((s) => s.conn);
  const [addOpen, setAddOpen] = useState(false);

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

      {/* 列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {bots.length === 0 ? (
          <div className="mt-10 px-4 text-center text-xs text-muted">
            还没有机器人
            <br />
            点击右上角 + 添加
          </div>
        ) : (
          <ul className="space-y-0.5">
            {bots.map((b) => {
              const active = b.id === selectedId;
              return (
                <li key={b.id}>
                  <button
                    onClick={() => setSelected(b.id)}
                    className={cn(
                      "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                      active ? "bg-surface-2" : "hover:bg-surface-2/60",
                    )}
                  >
                    <StatusDot online={b.online} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{b.username}</span>
                      </div>
                      <div className="truncate text-[11px] text-muted">{b.host}</div>
                    </div>
                    {b.online ? (
                      <div className="flex flex-col items-end gap-0.5 text-[10px] text-muted">
                        <span className="flex items-center gap-0.5">
                          <Heart className="h-3 w-3 text-danger" /> {b.health ?? "-"}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <Drumstick className="h-3 w-3 text-warning" /> {b.food ?? "-"}
                        </span>
                      </div>
                    ) : b.reconnecting ? (
                      <Badge tone="warning">重连中</Badge>
                    ) : b.fatalReason ? (
                      <Badge tone="danger">离线</Badge>
                    ) : (
                      <Badge tone="neutral">离线</Badge>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
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
