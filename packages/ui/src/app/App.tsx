import { useEffect, useState } from "react";
import { useStore } from "@/store/useStore";
import { connect, loadSaved } from "@/lib/engine";
import { cn } from "@/lib/cn";
import ConnectScreen from "@/features/connect/ConnectScreen";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import BotPanel from "@/features/bot/BotPanel";
import Toaster from "@/components/ui/Toaster";

export default function App() {
  const status = useStore((s) => s.conn.status);
  const theme = useStore((s) => s.theme);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    const saved = loadSaved();
    if (saved) connect(saved.url, saved.token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showMain = status === "online" || status === "connecting";

  if (!showMain) {
    return (
      <>
        <ConnectScreen />
        <Toaster />
      </>
    );
  }

  return (
    <div className="relative flex h-full w-full overflow-hidden">
      {/* 侧栏：md+ 常驻，移动端为抽屉 */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-40 transition-transform duration-200 md:static md:z-auto md:translate-x-0",
          drawer ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        <Sidebar onNavigate={() => setDrawer(false)} />
      </div>
      {drawer && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setDrawer(false)} aria-hidden />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setDrawer(true)} />
        {status === "connecting" && (
          <div className="shrink-0 bg-warning/15 px-4 py-1.5 text-center text-xs text-warning">
            正在连接引擎…
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-hidden">
          <BotPanel />
        </main>
      </div>

      <Toaster />
    </div>
  );
}
