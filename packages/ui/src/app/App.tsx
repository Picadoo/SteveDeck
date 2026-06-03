import { useEffect, useState } from "react";
import { useStore } from "@/store/useStore";
import { connect, loadSaved } from "@/lib/engine";
import { cn } from "@/lib/cn";
import ConnectScreen from "@/features/connect/ConnectScreen";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import BotPanel from "@/features/bot/BotPanel";
import AddBotDialog from "@/features/bot/AddBotDialog";
import Toaster from "@/components/ui/Toaster";

const NAV_KEY = "mcbot.nav";
const isDesktop = () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;

export default function App() {
  const status = useStore((s) => s.conn.status);
  const theme = useStore((s) => s.theme);
  // 侧栏开合：桌面端默认展开且记忆上次选择；移动端为抽屉，默认收起
  const [navOpen, setNavOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(NAV_KEY);
      if (saved != null) return saved === "1";
    } catch {
      /* ignore */
    }
    return isDesktop();
  });
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    const saved = loadSaved();
    if (saved) connect(saved.url, saved.token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切换侧栏（记忆桌面端偏好）
  function toggleNav() {
    setNavOpen((v) => {
      const nv = !v;
      try {
        localStorage.setItem(NAV_KEY, nv ? "1" : "0");
      } catch {
        /* ignore */
      }
      return nv;
    });
  }

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
      {/* 侧栏：可收起。桌面端收起后回收空间；移动端为抽屉浮层 */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-40 transition-transform duration-200 md:static md:z-auto",
          navOpen ? "translate-x-0" : "-translate-x-full md:hidden",
        )}
      >
        <Sidebar
          onNavigate={() => {
            if (!isDesktop()) setNavOpen(false); // 仅移动端选号后自动收抽屉
          }}
          onAddBot={() => setAddOpen(true)}
        />
      </div>
      {navOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setNavOpen(false)} aria-hidden />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar navOpen={navOpen} onToggleNav={toggleNav} onAddBot={() => setAddOpen(true)} />
        {status === "connecting" && (
          <div className="shrink-0 bg-warning/15 px-4 py-1.5 text-center text-xs text-warning">
            正在连接引擎…
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-hidden">
          <BotPanel onAddBot={() => setAddOpen(true)} />
        </main>
      </div>

      <AddBotDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <Toaster />
    </div>
  );
}
