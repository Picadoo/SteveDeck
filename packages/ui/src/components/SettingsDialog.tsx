import { useEffect, useState, type ReactNode } from "react";
import { LogOut, Copy } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { useStore } from "@/store/useStore";
import { cn } from "@/lib/cn";
import {
  fetchConnectionInfo,
  disconnect,
  forgetConn,
  isTauri,
  getEngineConfig,
  setEngineConfig,
  restartApp,
} from "@/lib/engine";

interface ConnInfo {
  addresses: string[];
  port: number;
  connectionString: string;
  qrcodeDataUrl?: string;
}

export default function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const conn = useStore((s) => s.conn);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const invMode = useStore((s) => s.invMode);
  const setInvMode = useStore((s) => s.setInvMode);
  const pushToast = useStore((s) => s.pushToast);
  const [info, setInfo] = useState<ConnInfo | null>(null);

  useEffect(() => {
    if (open) {
      setInfo(null);
      fetchConnectionInfo().then(setInfo);
    }
  }, [open]);

  if (!open) return null;

  async function copy(t: string) {
    try {
      await navigator.clipboard.writeText(t);
      pushToast("已复制", "success");
    } catch {
      pushToast("复制失败", "error");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="设置">
      <div className="space-y-5">
        <Section title="当前引擎">
          <Row k="地址" v={conn.url.replace(/^https?:\/\//, "") || "—"} />
          <Row k="版本" v={conn.engine?.version ? "v" + conn.engine.version : "—"} />
          <Row k="状态" v={conn.status === "online" ? "已连接" : "连接中"} />
        </Section>

        {isTauri() && <EngineSourceSection />}

        <Section title="连接手机 / 其他设备">
          {info?.qrcodeDataUrl ? (
            <div className="flex flex-col items-center gap-2">
              <img src={info.qrcodeDataUrl} alt="连接二维码" className="h-40 w-40 rounded-lg bg-white p-1" />
              <p className="text-center text-[11px] text-muted">在另一台设备的客户端里扫描，或复制下面的连接串</p>
              <div className="flex w-full items-center gap-2">
                <code className="flex-1 truncate rounded-lg bg-surface-2 px-2 py-1.5 text-[11px]">
                  {info.connectionString}
                </code>
                <Button size="sm" variant="secondary" onClick={() => copy(info.connectionString)}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted">加载中… 若长期为空，可能是引擎不可达。</p>
          )}
        </Section>

        <Section title="其它">
          <div className="flex items-center justify-between">
            <span className="text-sm">主题</span>
            <Button size="sm" variant="secondary" onClick={toggleTheme}>
              {theme === "dark" ? "深色" : "浅色"}
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm">背包显示</div>
              <div className="text-[11px] text-muted">完全版带贴图/彩色名/描述；精简版纯文本更轻</div>
            </div>
            <div className="flex shrink-0 overflow-hidden rounded-lg border border-border text-xs">
              {(["lite", "full"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setInvMode(m)}
                  className={cn(
                    "px-2.5 py-1 transition-colors",
                    invMode === m ? "bg-accent/15 text-accent" : "text-muted hover:text-fg",
                  )}
                >
                  {m === "lite" ? "精简" : "完全"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">切换 / 断开引擎</span>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                disconnect();
                forgetConn();
                onClose();
              }}
            >
              <LogOut className="h-3.5 w-3.5" /> 断开
            </Button>
          </div>
        </Section>
      </div>
    </Modal>
  );
}

// 引擎来源（仅桌面版）：内置自带引擎 / 连远程 Docker 引擎。改动写入 AppData，重启后由 Rust 侧决定起不起内置引擎。
function EngineSourceSection() {
  const pushToast = useStore((s) => s.pushToast);
  const [mode, setMode] = useState<"builtin" | "remote">("builtin");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [dirty, setDirty] = useState(false);
  const [needRestart, setNeedRestart] = useState(false);

  useEffect(() => {
    getEngineConfig().then((c) => {
      if (!c) return;
      setMode(c.mode === "remote" ? "remote" : "builtin");
      setUrl(c.url || "");
      setToken(c.token || "");
    });
  }, []);

  async function save() {
    const ok = await setEngineConfig(mode, url.trim(), token.trim());
    if (ok) {
      setDirty(false);
      setNeedRestart(true);
      pushToast("已保存，重启后生效", "success");
    } else {
      pushToast("保存失败", "error");
    }
  }

  return (
    <Section title="引擎来源（桌面版）">
      <div className="flex items-center justify-between">
        <div className="pr-3">
          <div className="text-sm">引擎运行在哪</div>
          <div className="text-[11px] text-muted">内置=本机自带引擎；远程=连 Docker/服务器引擎，本机不再起引擎</div>
        </div>
        <div className="flex shrink-0 overflow-hidden rounded-lg border border-border text-xs">
          {(["builtin", "remote"] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setDirty(true);
              }}
              className={cn(
                "px-2.5 py-1 transition-colors",
                mode === m ? "bg-accent/15 text-accent" : "text-muted hover:text-fg",
              )}
            >
              {m === "builtin" ? "内置" : "远程"}
            </button>
          ))}
        </div>
      </div>
      {mode === "remote" && (
        <div className="space-y-2">
          <input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setDirty(true);
            }}
            placeholder="引擎地址，如 http://192.168.1.10:8723"
            className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg"
          />
          <input
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setDirty(true);
            }}
            placeholder="访问令牌"
            className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg"
          />
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        {needRestart && (
          <Button size="sm" variant="secondary" onClick={() => restartApp()}>
            立即重启
          </Button>
        )}
        <Button size="sm" onClick={save} disabled={!dirty}>
          保存
        </Button>
      </div>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold text-muted">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted">{k}</span>
      <span className="truncate pl-2 font-medium">{v}</span>
    </div>
  );
}
