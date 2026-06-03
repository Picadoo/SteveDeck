import { useState } from "react";
import { Wifi, WifiOff, Loader2, Moon, Sun, PanelLeft, PanelLeftClose, Settings } from "lucide-react";
import { useStore } from "@/store/useStore";
import { IconButton, Badge, StatusDot } from "@/components/ui/primitives";
import SettingsDialog from "./SettingsDialog";

export default function TopBar({
  navOpen,
  onToggleNav,
}: {
  navOpen: boolean;
  onToggleNav: () => void;
}) {
  const conn = useStore((s) => s.conn);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const selected = useStore((s) => s.bots.find((b) => b.id === s.selectedId));
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-surface px-4 drag-region">
        <div className="no-drag flex min-w-0 items-center gap-2">
          <IconButton onClick={onToggleNav} title={navOpen ? "收起侧栏" : "展开侧栏"}>
            {navOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
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
          <IconButton onClick={() => setSettingsOpen(true)} title="设置">
            <Settings className="h-4 w-4" />
          </IconButton>
        </div>
      </header>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
