import { Wifi, WifiOff, Loader2, Moon, Sun, Menu } from "lucide-react";
import { useStore } from "@/store/useStore";
import { IconButton, Badge, StatusDot } from "@/components/ui/primitives";

export default function TopBar({ onMenu }: { onMenu: () => void }) {
  const conn = useStore((s) => s.conn);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const selected = useStore((s) => s.bots.find((b) => b.id === s.selectedId));

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-surface px-4 drag-region">
      <div className="flex min-w-0 items-center gap-2">
        <IconButton onClick={onMenu} className="md:hidden" title="菜单">
          <Menu className="h-4 w-4" />
        </IconButton>
        {selected ? (
          <>
            <StatusDot online={selected.online} />
            <span className="truncate text-sm font-medium">{selected.username}</span>
            <span className="truncate text-xs text-muted">@{selected.host}</span>
          </>
        ) : (
          <span className="text-sm text-muted">未选择机器人</span>
        )}
      </div>
      <div className="no-drag flex items-center gap-2">
        {conn.status === "connecting" ? (
          <Badge tone="warning">
            <Loader2 className="h-3 w-3 animate-spin" /> 连接中
          </Badge>
        ) : conn.status === "online" ? (
          <Badge tone="success">
            <Wifi className="h-3 w-3" /> 已连接
          </Badge>
        ) : (
          <Badge tone="danger">
            <WifiOff className="h-3 w-3" /> 离线
          </Badge>
        )}
        <IconButton onClick={toggleTheme} title="切换主题">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </IconButton>
      </div>
    </header>
  );
}
