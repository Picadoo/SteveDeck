import { useEffect, useState } from "react";
import { useStore } from "@/store/useStore";
import { connect, loadSaved, parseConnectionString, tryTauriAutoConnect } from "@/lib/engine";
import { cn } from "@/lib/cn";
import ConnectScreen from "@/features/connect/ConnectScreen";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import BotPanel from "@/features/bot/BotPanel";
import TitleBar from "@/components/TitleBar";
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

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    // 扫码直连：URL #mcbot=<连接串>（引擎二维码即此格式）→ 浏览器打开即自动配对。
    // 连接串读完立即从地址栏清掉，不把令牌留在地址栏/分享截图里。
    try {
      const m = /[#&]mcbot=([^&]+)/.exec(window.location.hash);
      if (m) {
        const parsed = parseConnectionString(decodeURIComponent(m[1]));
        if (parsed) {
          history.replaceState(null, "", window.location.pathname + window.location.search);
          connect(parsed.url, parsed.token || "");
          return;
        }
      }
    } catch {
      /* 解析失败走常规流程 */
    }
    // 内置桌面版（Tauri 内）：先向 Rust 取本地引擎地址+令牌自动连接；
    // 非 Tauri（网页/移动浏览器）或取不到时，回退到上次保存的连接。
    let cancelled = false;
    void (async () => {
      const viaTauri = await tryTauriAutoConnect();
      if (cancelled || viaTauri) return;
      const saved = loadSaved();
      if (saved) connect(saved.url, saved.token);
    })();
    return () => {
      cancelled = true;
    };
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

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* 桌面无边框：连接屏显示细标题栏；主界面的窗口控制并入 TopBar */}
      {!showMain && <TitleBar />}

      {!showMain ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ConnectScreen />
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
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
            />
          </div>
          {navOpen && (
            <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setNavOpen(false)} aria-hidden />
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar navOpen={navOpen} onToggleNav={toggleNav} />
            {status === "connecting" && (
              <div className="shrink-0 bg-warning/15 px-4 py-1.5 text-center text-xs text-warning">
                正在连接引擎…
              </div>
            )}
            <main className="min-h-0 flex-1 overflow-hidden">
              <BotPanel />
            </main>
          </div>
        </div>
      )}

      <Toaster />
    </div>
  );
}
