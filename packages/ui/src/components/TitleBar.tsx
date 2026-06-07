import WindowControls from "./WindowControls";

// 连接屏专用细标题栏（主界面的窗口控制并入 TopBar）。仅 Tauri 桌面渲染，网页/移动返回 null。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isTauri = (): boolean => !!(globalThis as any)?.__TAURI__?.window;

export default function TitleBar() {
  if (!isTauri()) return null;
  return (
    <div className="flex h-8 shrink-0 items-stretch justify-between border-b border-border bg-surface select-none">
      <div data-tauri-drag-region className="flex flex-1 items-center pl-3 text-xs font-medium text-muted">
        mc-bot-player
      </div>
      <WindowControls />
    </div>
  );
}
