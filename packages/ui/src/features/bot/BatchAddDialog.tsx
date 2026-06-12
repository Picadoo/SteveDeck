import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Users } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { Button, Input } from "@/components/ui/primitives";
import { cmd } from "@/lib/engine";
import { useStore } from "@/store/useStore";
import { generateFakeNames } from "@/lib/fakeNames";

/**
 * 批量假人（氛围组）：服主用——批量创建轻量 lite 机器人撑在线人数。
 * - lite 模式：只保留连接/自动注册登录/防挂机踢，不挂任何功能模块，单只占用极低；
 * - 名字由起名器生成（多风格混杂、无连号规律，不会一眼看出是假人），可手改；
 * - 登录服支持：首次进服发注册指令、之后每次发登录指令（{password} 占位）；
 * - 错峰进服：每隔 N 秒进一个，避免「一秒涌入 20 人」的假象与服务器连接节流。
 */
export default function BatchAddDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pushToast = useStore((s) => s.pushToast);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("25565");
  const [version, setVersion] = useState("1.20.1");
  const [count, setCount] = useState(10);
  const [names, setNames] = useState("");
  const [pwdMode, setPwdMode] = useState<"none" | "shared" | "random">("none");
  const [sharedPwd, setSharedPwd] = useState("");
  const [loginCmd, setLoginCmd] = useState("/login {password}");
  const [registerCmd, setRegisterCmd] = useState("/register {password} {password}");
  const [gapSec, setGapSec] = useState(5);
  const [progress, setProgress] = useState<{ done: number; total: number; fail: number } | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (open && !names) setNames(generateFakeNames(count).join("\n"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const regen = () => setNames(generateFakeNames(count).join("\n"));

  async function create() {
    const list = [...new Set(names.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))].filter((n) =>
      /^[A-Za-z0-9_]{3,16}$/.test(n),
    );
    if (!host.trim()) return pushToast("请填服务器地址", "error");
    if (!list.length) return pushToast("名单为空或全部不合法（3-16 位字母/数字/下划线）", "error");
    if (pwdMode === "shared" && !sharedPwd.trim()) return pushToast("请填共用密码", "error");

    cancelRef.current = false;
    setProgress({ done: 0, total: list.length, fail: 0 });
    let fail = 0;
    for (let i = 0; i < list.length; i++) {
      if (cancelRef.current) break;
      const username = list[i];
      const pwd =
        pwdMode === "shared" ? sharedPwd.trim() : pwdMode === "random" ? Math.random().toString(36).slice(2, 12) : "";
      const r = await cmd
        .addBot({
          username,
          host: host.trim(),
          port: Number(port) || 25565,
          version: version.trim() || undefined,
          loginPassword: pwd || undefined,
          loginCommand: pwd ? loginCmd.trim() || undefined : undefined,
          note: "假人",
          settings: {
            lite: true,
            ...(pwd && registerCmd.trim() ? { registerCommand: registerCmd.trim() } : {}),
          },
        })
        .catch(() => ({ ok: false as const, error: "请求失败" }));
      if (!r.ok) fail++;
      setProgress({ done: i + 1, total: list.length, fail });
      // 错峰进服：最后一个不用等
      if (i < list.length - 1 && gapSec > 0 && !cancelRef.current) {
        await new Promise((res) => setTimeout(res, gapSec * 1000));
      }
    }
    setProgress(null);
    pushToast(
      cancelRef.current ? "已取消（已创建的保留）" : `批量创建完成：成功 ${list.length - fail}，失败 ${fail}`,
      fail ? "info" : "success",
    );
    if (!cancelRef.current) onClose();
  }

  const busy = progress !== null;
  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="批量假人（氛围组）"
      size="lg"
      footer={
        busy ? (
          <>
            <span className="mr-auto flex items-center gap-2 text-xs text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              创建中 {progress.done}/{progress.total}
              {progress.fail > 0 && <span className="text-danger">失败 {progress.fail}</span>}
              （每 {gapSec}s 进一个，防集体涌入）
            </span>
            <Button variant="ghost" onClick={() => (cancelRef.current = true)}>
              取消
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button variant="primary" onClick={create}>
              <Users className="h-3.5 w-3.5" /> 开始创建
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3.5">
        <p className="text-[11px] leading-relaxed text-muted">
          假人是<span className="text-fg">轻量模式</span>：只连接 + 自动注册/登录 + 防挂机踢，不带视角/模块/脚本，
          单只占用极低，适合批量撑在线。创建后和普通机器人一样可单独启停/删除/聊天。
        </p>
        <div className="grid grid-cols-3 gap-2">
          <label className="col-span-2 block">
            <span className="mb-1 block text-sm">服务器地址</span>
            <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="play.example.com" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm">端口</span>
            <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="25565" />
          </label>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className="mb-1 block text-sm">版本</span>
            <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.20.1" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm">数量</span>
            <Input
              type="number"
              min={1}
              max={50}
              value={String(count)}
              onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm">错峰间隔（秒）</span>
            <Input
              type="number"
              min={0}
              max={60}
              value={String(gapSec)}
              onChange={(e) => setGapSec(Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
            />
          </label>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm">名单（一行一个，可手改）</span>
            <button
              type="button"
              onClick={regen}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-2 hover:text-fg"
            >
              <RefreshCw className="h-3 w-3" /> 换一批
            </button>
          </div>
          <textarea
            value={names}
            onChange={(e) => setNames(e.target.value)}
            rows={6}
            spellCheck={false}
            className="w-full resize-y rounded-lg border border-border bg-surface px-2.5 py-2 font-mono text-xs leading-relaxed outline-none focus:ring-2 focus:ring-accent/50"
          />
          <p className="mt-1 text-[11px] text-muted">
            起名器多风格混杂、无连号规律，不会一眼看出是假人；也可整段粘贴自己的名单。
          </p>
        </div>
        <div>
          <span className="mb-1.5 block text-sm">登录服（无登录插件的服选「不需要」）</span>
          <div className="mb-2 flex overflow-hidden rounded-lg border border-border text-[11px]">
            {(
              [
                ["none", "不需要"],
                ["shared", "共用密码"],
                ["random", "每人随机密码"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setPwdMode(v)}
                className={
                  "flex-1 px-2 py-1.5 transition-colors " +
                  (pwdMode === v ? "bg-accent/15 text-accent" : "text-muted hover:text-fg")
                }
              >
                {label}
              </button>
            ))}
          </div>
          {pwdMode !== "none" && (
            <div className="space-y-2">
              {pwdMode === "shared" && (
                <Input value={sharedPwd} onChange={(e) => setSharedPwd(e.target.value)} placeholder="共用密码" />
              )}
              <label className="block">
                <span className="mb-1 block text-xs text-muted">登录指令（每次进服发送）</span>
                <Input value={loginCmd} onChange={(e) => setLoginCmd(e.target.value)} placeholder="/login {password}" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-muted">注册指令（首次进服发送一次；留空=不注册）</span>
                <Input
                  value={registerCmd}
                  onChange={(e) => setRegisterCmd(e.target.value)}
                  placeholder="/register {password} {password}"
                />
              </label>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
