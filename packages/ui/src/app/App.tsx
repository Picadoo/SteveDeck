import { useEffect } from "react";
import { useStore } from "@/store/useStore";
import { connect, loadSaved } from "@/lib/engine";
import ConnectScreen from "@/features/connect/ConnectScreen";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import BotPanel from "@/features/bot/BotPanel";

export default function App() {
  const status = useStore((s) => s.conn.status);
  const theme = useStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    const saved = loadSaved();
    if (saved) connect(saved.url, saved.token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showMain = status === "online" || status === "connecting";

  if (!showMain) return <ConnectScreen />;

  return (
    <div className="flex h-full w-full overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-hidden">
          <BotPanel />
        </main>
      </div>
    </div>
  );
}
