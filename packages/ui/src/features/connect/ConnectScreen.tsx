import { useState, type FormEvent } from "react";
import { Bot, Moon, Sun, ArrowRight, KeyRound, Server, Loader2 } from "lucide-react";
import { Button, Card, Input, IconButton } from "@/components/ui/primitives";
import { connect, parseConnectionString, normalizeUrl } from "@/lib/engine";
import { useStore } from "@/store/useStore";

export default function ConnectScreen() {
  const [addr, setAddr] = useState("");
  const [token, setToken] = useState("");
  const conn = useStore((s) => s.conn);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const connecting = conn.status === "connecting";

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseConnectionString(addr);
    if (parsed) {
      connect(parsed.url, parsed.token || token.trim());
      return;
    }
    if (!addr.trim()) return;
    connect(normalizeUrl(addr), token.trim());
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center bg-bg p-6">
      <div className="absolute right-4 top-4">
        <IconButton onClick={toggleTheme} title="切换主题">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </IconButton>
      </div>

      <Card className="w-full max-w-md p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent">
            <Bot className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-semibold">连接到你的引擎</h1>
          <p className="mt-1 text-sm text-muted">
            填入引擎地址与访问令牌，或直接粘贴连接串
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted">
              <Server className="h-3.5 w-3.5" /> 引擎地址 / 连接串
            </label>
            <Input
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder="192.168.1.10:8723 或 mcbot://..."
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted">
              <KeyRound className="h-3.5 w-3.5" /> 访问令牌
            </label>
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="粘贴连接串时可留空"
            />
          </div>

          {conn.status === "error" && conn.error && (
            <div className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
              {conn.error}
            </div>
          )}

          <Button type="submit" variant="primary" className="w-full" disabled={connecting}>
            {connecting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> 连接中…
              </>
            ) : (
              <>
                连接 <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs leading-relaxed text-muted">
          引擎首次启动会在日志里打印地址、令牌与连接串。<br />
          手机端可扫描引擎的二维码自动填入。
        </p>
      </Card>
    </div>
  );
}
