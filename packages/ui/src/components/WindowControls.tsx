import { Minus, Square, X } from "lucide-react";

// 无边框窗口控制：最小化 / 最大化·还原 / 关闭（→收起到托盘）。仅 Tauri 桌面内渲染。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tauriWindow = (): any => (globalThis as any)?.__TAURI__?.window?.getCurrentWindow?.() ?? null;

export default function WindowControls({ className = "" }: { className?: string }) {
  const win = tauriWindow();
  if (!win) return null;
  const btn = "no-drag flex w-11 items-center justify-center text-muted transition-colors";
  return (
    <div className={`flex items-stretch ${className}`}>
      <button className={`${btn} hover:bg-surface-2 hover:text-fg`} title="最小化" onClick={() => win.minimize()}>
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        className={`${btn} hover:bg-surface-2 hover:text-fg`}
        title="最大化 / 还原"
        onClick={() => win.toggleMaximize()}
      >
        <Square className="h-3 w-3" />
      </button>
      <button className={`${btn} hover:bg-red-600 hover:text-white`} title="关闭（收起到托盘）" onClick={() => win.close()}>
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
