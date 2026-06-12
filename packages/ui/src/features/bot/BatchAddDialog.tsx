import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw, Trash2, Users } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { Button, Input } from "@/components/ui/primitives";
import { cmd } from "@/lib/engine";
import { useStore } from "@/store/useStore";
import { generateFakeNames } from "@/lib/fakeNames";

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
  const bots = useStore((s) => s.bots);
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

  const liteBots = useMemo(() => bots.filter((b) => b.lite), [bots]);

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
        setProgress(null);
        return pushToast("首个假人 30 秒内未能上线，请检查服务器地址/版本/登录配置后重试（已创建的可手动删除）", "error");
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

  // 批量删除带二次确认（5 秒内再点一次才真删，防误触全灭）
  const [deleting, setDeleting] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  async function deleteAllLite() {
    if (!confirmDel) {
      setConfirmDel(true);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmDel(false), 5000);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirmDel(false);
    const ids = liteBots.map((b) => b.id);
    if (!ids.length) return pushToast("没有假人可删", "info");
    setDeleting(true);
    let ok = 0;
    for (const id of ids) {
      const r = await cmd.deleteBot(id).catch(() => ({ ok: false }));
      if (r.ok) ok++;
    }
    setDeleting(false);
    pushToast(`已删除 ${ok}/${ids.length} 个假人`, ok === ids.length ? "success" : "info");
  }

  // 批量启停：服主场景——白天人多让假人下线、晚上人少再拉起来撑场面
  const [bulkOp, setBulkOp] = useState<"stop" | "start" | null>(null);
  async function toggleAllLite(action: "stop" | "start") {
    const targets = liteBots.filter((b) => (action === "stop" ? b.online || b.reconnecting : !b.online));
    if (!targets.length) return pushToast(action === "stop" ? "假人都已离线" : "假人都已在线", "info");
    setBulkOp(action);
    for (let i = 0; i < targets.length; i++) {
      await (action === "stop" ? cmd.stop(targets[i].id) : cmd.reconnect(targets[i].id)).catch(() => null);
      // 启动错峰沿用创建时的间隔逻辑（停止瞬时无所谓）
      if (action === "start" && i < targets.length - 1 && gapSec > 0) {
        await new Promise((res) => setTimeout(res, Math.min(gapSec, 3) * 1000));
      }
    }
    setBulkOp(null);
    pushToast(action === "stop" ? `已停止 ${targets.length} 个假人` : `正在拉起 ${targets.length} 个假人`, "success");
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
            {liteBots.length > 0 && (
              <div className="mr-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  className={confirmDel ? "bg-danger/15 text-danger" : "text-danger hover:bg-danger/10"}
                  onClick={deleteAllLite}
                  disabled={deleting || bulkOp !== null}
                >
                  {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  {confirmDel ? `再点一次确认删 ${liteBots.length} 个` : `清除全部假人（${liteBots.length}）`}
                </Button>
                <Button
                  variant="ghost"
                  className="text-muted"
                  onClick={() => toggleAllLite(liteBots.some((b) => b.online) ? "stop" : "start")}
                  disabled={deleting || bulkOp !== null}
                  title="服主场景：白天人多让假人下线，晚上再拉起来"
                >
                  {bulkOp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {liteBots.some((b) => b.online) ? "全部下线" : "全部上线"}
                </Button>
              </div>
            )}
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
          假人是<span className="text-fg">轻量模式</span>：只连接 + 自动注册/登录 + 防挂机踢，不带视角/模块/脚本，
          单只占用极低，适合批量撑在线。创建后和普通机器人一样可单独启停/删除/聊天。
        </p>
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
