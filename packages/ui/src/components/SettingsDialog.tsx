import { useEffect, useState, type ReactNode } from "react";
import { LogOut, Copy } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { useStore } from "@/store/useStore";
import { fetchConnectionInfo, disconnect, forgetConn } from "@/lib/engine";

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
