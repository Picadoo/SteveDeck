import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Play, RefreshCw, Square, Trash2, Users } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { Button, Input } from "@/components/ui/primitives";
import { cmd } from "@/lib/engine";
import { useStore } from "@/store/useStore";
import { generateFakeNames } from "@/lib/fakeNames";
import type { BotSummary } from "@mcbot/protocol";

// 关闭态用的稳定空数组：弹窗常驻挂载在 Sidebar，若直接订阅 s.bots，
// 每次状态推送（2s/bot）都会让关闭的弹窗白渲染一轮
const EMPTY_BOTS: BotSummary[] = [];

function parseNames(raw: string): string[] {
  return [...new Set(raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))].filter((n) =>
    /^[A-Za-z0-9_]{3,16}$/.test(n),
  );
}

/**
 * 批量假人（氛围组）：服主用——批量创建轻量 lite 机器人撑在线人数。
 * - lite 模式：只保留连接/自动注册登录/防挂机踢，不挂任何功能模块，单只占用极低；
 * - 名字由起名器生成（多风格混杂、无连号规律，不会一眼看出是假人），可手改；
 * - 登录服支持：首次进服发注册指令、之后每次发登录指令（{password} 占位）；
 * - 错峰进服：每隔 N 秒进一个，避免「一秒涌入 20 人」的假象与服务器连接节流。
 */
export default function BatchAddDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pushToast = useStore((s) => s.pushToast);
  const bots = useStore((s) => (open ? s.bots : EMPTY_BOTS));
  const [host, setHost] = useState("");
  const [port, setPort] = useState("25565");
  const [version, setVersion] = useState("");
  const [genCount, setGenCount] = useState(10);
  const [names, setNames] = useState("");
  const [pwdMode, setPwdMode] = useState<"none" | "shared" | "random">("none");
  const [sharedPwd, setSharedPwd] = useState("");
  const [loginCmd, setLoginCmd] = useState("/login {password}");
  const [registerCmd, setRegisterCmd] = useState("/register {password} {password}");
  const [gapSec, setGapSec] = useState(5);
  const [probeFirst, setProbeFirst] = useState(true);
  const [progress, setProgress] = useState<{
    phase: "probe" | "batch";
    done: number;
    total: number;
    fail: number;
    probeStatus?: string;
  } | null>(null);
  const cancelRef = useRef(false);

  const validNames = useMemo(() => parseNames(names), [names]);

  // 现有假人按服务器分组（批量操作按服务器粒度，不再「全服一锅端」）
  const liteByHost = useMemo(() => {
    const m = new Map<string, BotSummary[]>();
    for (const b of bots) {
      if (!b.lite) continue;
      const arr = m.get(b.host) ?? [];
      arr.push(b);
      m.set(b.host, arr);
    }
    return [...m.entries()];
  }, [bots]);

  useEffect(() => {
    if (open && !names) setNames(generateFakeNames(genCount).join("\n"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const regen = () => setNames(generateFakeNames(genCount).join("\n"));

  const waitForOnline = useCallback(
    (botId: string, timeoutMs: number): Promise<boolean> =>
      new Promise((resolve) => {
        const start = Date.now();
        const check = () => {
          const bot = useStore.getState().bots.find((b) => b.id === botId);
          if (bot?.online) return resolve(true);
          if (bot?.fatalReason) return resolve(false);
          if (Date.now() - start > timeoutMs) return resolve(false);
          setTimeout(check, 800);
        };
        setTimeout(check, 1500);
      }),
    [],
  );

  async function create() {
    const list = validNames;
    if (!host.trim()) return pushToast("请填服务器地址", "error");
    if (!list.length) return pushToast("名单为空或全部不合法（3-16 位字母/数字/下划线）", "error");
    if (pwdMode === "shared" && !sharedPwd.trim()) return pushToast("请填共用密码", "error");

    cancelRef.current = false;

    const makePwd = () =>
      pwdMode === "shared" ? sharedPwd.trim() : pwdMode === "random" ? Math.random().toString(36).slice(2, 12) : "";

    const makePayload = (username: string) => {
      const pwd = makePwd();
      return {
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
      };
    };

    let startIdx = 0;

    if (probeFirst && list.length > 1) {
      setProgress({ phase: "probe", done: 0, total: list.length, fail: 0, probeStatus: "正在创建首个假人并尝试连接…" });
      const probeRes = await cmd.addBot(makePayload(list[0])).catch(() => ({ ok: false as const, error: "请求失败", data: undefined }));
      if (!probeRes.ok) {
        setProgress(null);
        return pushToast(`首个假人创建失败：${(probeRes as any).error || "未知错误"}`, "error");
      }
      if (cancelRef.current) {
        setProgress(null);
        return pushToast("已取消", "info");
      }
      const probeId = (probeRes as any).data?.id;
      setProgress((p) => p && { ...p, probeStatus: "等待首个假人上线（最多 30 秒）…" });
      const online = probeId ? await waitForOnline(probeId, 30_000) : false;
      if (cancelRef.current) {
        setProgress(null);
        return pushToast("已取消（首个假人已创建）", "info");
      }
      if (!online) {
        // 试连失败：自动回收这只假人——不留残骸，重试时也不会撞重名
        if (probeId) await cmd.deleteBot(probeId).catch(() => null);
        setProgress(null);
        return pushToast("首个假人 30 秒内未能上线（已自动回收），请检查服务器地址/版本/登录配置后重试", "error");
      }
      startIdx = 1;
    }

    setProgress({ phase: "batch", done: startIdx, total: list.length, fail: 0 });
    let fail = 0;
    for (let i = startIdx; i < list.length; i++) {
      if (cancelRef.current) break;
      const r = await cmd
        .addBot(makePayload(list[i]))
        .catch(() => ({ ok: false as const, error: "请求失败" }));
      if (!r.ok) fail++;
      setProgress({ phase: "batch", done: i + 1, total: list.length, fail });
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

  // 按服务器批量操作：busyHost=正在执行的服；删除带 5 秒二次确认（confirmDelHost 记录待确认的服）
  const [busyHost, setBusyHost] = useState<string | null>(null);
  const [confirmDelHost, setConfirmDelHost] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function deleteHostLite(host: string, list: BotSummary[]) {
    if (confirmDelHost !== host) {
      setConfirmDelHost(host);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmDelHost(null), 5000);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirmDelHost(null);
    setBusyHost(host);
    let ok = 0;
    for (const b of list) {
      const r = await cmd.deleteBot(b.id).catch(() => ({ ok: false }));
      if (r.ok) ok++;
    }
    setBusyHost(null);
    pushToast(`${host}：已删除 ${ok}/${list.length} 个假人`, ok === list.length ? "success" : "info");
  }

  // 启停：服主白天人多让假人下线、晚上再拉起来（上线沿用错峰间隔，停止瞬时执行）
  async function toggleHostLite(host: string, list: BotSummary[]) {
    const anyOnline = list.some((b) => b.online || b.reconnecting);
    const targets = list.filter((b) => (anyOnline ? b.online || b.reconnecting : !b.online));
    if (!targets.length) return;
    setBusyHost(host);
    for (let i = 0; i < targets.length; i++) {
      await (anyOnline ? cmd.stop(targets[i].id) : cmd.reconnect(targets[i].id)).catch(() => null);
      if (!anyOnline && i < targets.length - 1 && gapSec > 0) {
        await new Promise((res) => setTimeout(res, Math.min(gapSec, 3) * 1000));
      }
    }
    setBusyHost(null);
    pushToast(`${host}：${anyOnline ? `已停止 ${targets.length} 个假人` : `正在拉起 ${targets.length} 个假人`}`, "success");
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
              {progress.phase === "probe"
                ? progress.probeStatus
                : `创建中 ${progress.done}/${progress.total}${progress.fail > 0 ? `（失败 ${progress.fail}）` : ""}　每 ${gapSec}s 进一个`}
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
            <Button variant="primary" onClick={create} disabled={!validNames.length}>
              <Users className="h-3.5 w-3.5" /> 创建 {validNames.length} 个假人
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3.5">
        <p className="text-[11px] leading-relaxed text-muted">
          假人是<span className="text-fg">轻量模式</span>：只连接 + 自动注册/登录 + 防挂机踢，不带模块/脚本，
          单只占用极低，适合批量撑在线。创建后可单独启停/删除/聊天，视角/背包点开才加载。
        </p>

        {liteByHost.length > 0 && (
          <div className="rounded-lg border border-border/60 p-2.5">
            <div className="mb-1.5 text-[11px] font-medium text-muted">现有假人（按服务器批量操作）</div>
            <div className="space-y-1">
              {liteByHost.map(([h, list]) => {
                const online = list.filter((b) => b.online).length;
                const anyOnline = list.some((b) => b.online || b.reconnecting);
                const busyThis = busyHost === h;
                return (
                  <div key={h} className="flex items-center gap-2 rounded-md bg-surface-2/40 px-2 py-1.5 text-xs">
                    <span className="min-w-0 flex-1 truncate" title={h}>
                      {h}
                      <span className="ml-1.5 tabular-nums text-muted">{online}/{list.length} 在线</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleHostLite(h, list)}
                      disabled={busyHost !== null || busy}
                      className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50"
                      title={anyOnline ? "全部下线" : "全部上线（按错峰间隔）"}
                    >
                      {busyThis ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : anyOnline ? (
                        <Square className="h-3 w-3" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                      {anyOnline ? "下线" : "上线"}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteHostLite(h, list)}
                      disabled={busyHost !== null || busy}
                      className={
                        "flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] disabled:opacity-50 " +
                        (confirmDelHost === h ? "bg-danger/15 text-danger" : "text-danger/80 hover:bg-danger/10 hover:text-danger")
                      }
                    >
                      <Trash2 className="h-3 w-3" />
                      {confirmDelHost === h ? `确认删 ${list.length} 只？` : "删除"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <label className="col-span-2 block">
            <span className="mb-1 block text-sm">服务器地址</span>
            <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="play.example.com 或 play.example.com:30066" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm">端口</span>
            <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="25565" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-sm">版本（留空自动识别）</span>
            <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="自动识别" />
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
            <span className="text-sm">
              名单（一行一个）
              {validNames.length > 0 && (
                <span className="ml-1.5 text-xs text-accent">{validNames.length} 个有效名字</span>
              )}
            </span>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                min={1}
                max={50}
                value={String(genCount)}
                onChange={(e) => setGenCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                className="!w-14 !py-0.5 text-center text-[11px]"
              />
              <button
                type="button"
                onClick={regen}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-2 hover:text-fg"
              >
                <RefreshCw className="h-3 w-3" /> 生成
              </button>
            </div>
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
        <div className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2">
          <input
            type="checkbox"
            id="probe-first"
            checked={probeFirst}
            onChange={(e) => setProbeFirst(e.target.checked)}
            className="accent-accent"
          />
          <label htmlFor="probe-first" className="flex-1 text-xs">
            <span className="font-medium">先测试连接</span>
            <span className="ml-1 text-muted">
              先让第一个假人进服，确认能连上再批量创建其余（避免地址填错白创一堆）
            </span>
          </label>
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
