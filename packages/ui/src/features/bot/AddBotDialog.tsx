import { useState, useEffect, useMemo, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { Button, Input, Switch } from "@/components/ui/primitives";
import { cmd } from "@/lib/engine";
import { useStore } from "@/store/useStore";
import type { BotSettings } from "@mcbot/protocol";

const EMPTY = {
  username: "",
  host: "",
  port: "25565",
  version: "1.20.1",
  loginPassword: "",
  note: "",
  maxReconnectAttempts: "0", // 0 = 无限
  reconnectDelay: "5",
};

export interface EditInitial {
  username: string;
  host: string;
  port?: number;
  version?: string;
  /** API-10：后端不再回传明文密码，仅回布尔「是否已设密码」，用于占位提示与「留空＝不改」逻辑 */
  hasLoginPassword?: boolean;
  note?: string;
  settings?: BotSettings;
}

export default function AddBotDialog({
  open,
  onClose,
  editId,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  editId?: string;
  initial?: EditInitial;
}) {
  const pushToast = useStore((s) => s.pushToast);
  const [form, setForm] = useState({ ...EMPTY });
  const [autoReconnect, setAutoReconnect] = useState(true);
  const [forge, setForge] = useState(false);
  const [rawMove, setRawMove] = useState(false);
  // 编辑态：后端只告诉我们「是否已设密码」（不回明文）。据此给密码框占位提示并实现「留空＝不改」。
  const [hasSavedPassword, setHasSavedPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isEdit = !!editId;
  const bots = useStore((s) => s.bots);
  // 已有服务器去重（按 host）：加多个号时一键复用服务器信息，省得反复输地址/端口/版本/Forge 等
  const servers = useMemo(() => {
    const seen = new Map<string, { id: string; label: string }>();
    for (const b of bots) {
      if (!b.host || seen.has(b.host)) continue;
      seen.set(b.host, { id: b.id, label: b.note || b.host });
    }
    return [...seen.values()];
  }, [bots]);
  async function fillFromServer(botId: string) {
    const r = await cmd.getBotConfig(botId);
    if (!r.ok || !r.data) return;
    const c = r.data as EditInitial;
    setForm((f) => ({
      ...f,
      host: c.host || "",
      port: String(c.port ?? 25565),
      version: c.version || f.version,
      note: c.note || "",
    }));
    setForge(!!c.settings?.forge);
    setRawMove(!!c.settings?.rawMove);
    setAutoReconnect(c.settings?.autoReconnect !== false);
  }

  useEffect(() => {
    if (!open) return;
    if (initial) {
      const s = initial.settings || {};
      setForm({
        username: initial.username || "",
        host: initial.host || "",
        port: String(initial.port ?? 25565),
        version: initial.version || "1.20.1",
        loginPassword: "", // 编辑态密码框始终留空：后端不回明文，留空＝不修改
        note: initial.note || "",
        maxReconnectAttempts: String(s.maxReconnectAttempts ?? 0),
        reconnectDelay: String(s.reconnectDelay ?? 5),
      });
      setHasSavedPassword(!!initial.hasLoginPassword);
      setAutoReconnect(s.autoReconnect !== false); // 未设/true → 开
      setForge(!!s.forge);
      setRawMove(!!s.rawMove);
    } else {
      setForm({ ...EMPTY });
      setHasSavedPassword(false);
      setAutoReconnect(true);
      setForge(false);
      setRawMove(false);
    }
    setErr(null);
  }, [open, initial]);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.username.trim() || !form.host.trim()) {
      setErr("用户名和服务器地址必填");
      return;
    }
    setBusy(true);
    setErr(null);
    const payload = {
      username: form.username.trim(),
      host: form.host.trim(),
      port: Number(form.port) || 25565,
      version: form.version.trim() || undefined,
      // 仅当用户输入了新密码才提交；留空＝不带该字段（配合引擎「空＝保留旧密码」契约，编辑态不会误清密码）
      loginPassword: form.loginPassword ? form.loginPassword : undefined,
      note: form.note.trim() || undefined,
      // 只传重连相关键；引擎侧 merge，不会覆盖模块配置/定时等其它设置
      settings: {
        autoReconnect,
        maxReconnectAttempts: Math.max(0, Number(form.maxReconnectAttempts) || 0),
        reconnectDelay: Math.max(1, Number(form.reconnectDelay) || 5),
        forge,
        rawMove,
      } as BotSettings,
    };
    const res = isEdit ? await cmd.updateBot(editId!, payload) : await cmd.addBot(payload);
    setBusy(false);
    if (res.ok) {
      if (!isEdit) {
        setForm({ ...EMPTY });
        setAutoReconnect(true);
        setForge(false);
        setRawMove(false);
      }
      onClose();
      pushToast(isEdit ? "已保存，正在重连…" : "机器人已添加，正在连接…", "success");
    } else {
      setErr(res.error || (isEdit ? "保存失败" : "添加失败"));
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "编辑机器人" : "添加机器人"}>
      <form onSubmit={submit} className="space-y-3.5">
        {!isEdit && servers.length > 0 && (
          <div className="rounded-lg border border-border/60 bg-surface-2/30 p-2.5">
            <div className="mb-1.5 text-[11px] font-medium text-muted">复用已有服务器（点一下自动填好地址/版本/Forge 等，只需再填账号）</div>
            <div className="flex flex-wrap gap-1.5">
              {servers.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => fillFromServer(s.id)}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] transition-colors hover:border-accent hover:bg-accent/10"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <Field label="用户名（MC 登录名）">
          <Input value={form.username} onChange={(e) => set("username", e.target.value)} placeholder="例如 MyBot" autoFocus />
        </Field>
        <div className="grid grid-cols-[1fr_96px] gap-3">
          <Field label="服务器地址">
            <Input value={form.host} onChange={(e) => set("host", e.target.value)} placeholder="mc.example.com" />
          </Field>
          <Field label="端口">
            <Input value={form.port} onChange={(e) => set("port", e.target.value)} placeholder="25565" inputMode="numeric" />
          </Field>
        </div>
        <Field label="服务器备注（便于记忆，界面优先显示）">
          <Input value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="例如 花果山 RPG" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="游戏版本">
            <Input value={form.version} onChange={(e) => set("version", e.target.value)} placeholder="1.20.1" />
          </Field>
          <Field label="登录密码（可选）">
            <Input
              type="password"
              value={form.loginPassword}
              onChange={(e) => set("loginPassword", e.target.value)}
              placeholder={isEdit && hasSavedPassword ? "已保存，留空＝不修改" : "/login 用"}
            />
          </Field>
        </div>

        {/* 连接 / 重连 */}
        <div className="rounded-lg border border-border/60 p-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-sm font-medium">自动重连</div>
              <p className="text-[11px] leading-relaxed text-muted">断线后自动重连（被 ban/白名单等不可恢复断开仍会停）。关掉则掉线不重连。</p>
            </div>
            <Switch checked={autoReconnect} onChange={setAutoReconnect} />
          </div>
          {autoReconnect && (
            <div className="mt-2.5 grid grid-cols-2 gap-3 border-t border-border/40 pt-2.5">
              <Field label="最大重试次数（0 = 无限）">
                <Input
                  value={form.maxReconnectAttempts}
                  onChange={(e) => set("maxReconnectAttempts", e.target.value)}
                  placeholder="0"
                  inputMode="numeric"
                />
              </Field>
              <Field label="重试间隔（秒，会指数退避）">
                <Input
                  value={form.reconnectDelay}
                  onChange={(e) => set("reconnectDelay", e.target.value)}
                  placeholder="5"
                  inputMode="numeric"
                />
              </Field>
            </div>
          )}
        </div>

        {/* Forge 模组服 */}
        <div className="rounded-lg border border-border/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">Forge 模组服</div>
              <p className="text-[11px] leading-relaxed text-muted">
                服务器要求 Forge/FML 客户端（如龙核 DragonCore 服，登录被「requires FML/Forge」踢出）才开。开启后自动用 FML
                握手 + ping 探测模组连接。注意：能进服做<b>原版操作</b>（挂机/走动/聊天/普通容器），但模组渲染的 GUI（R/P 菜单）仍用不了。
              </p>
            </div>
            <Switch checked={forge} onChange={setForge} />
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-border/40 pt-2.5">
            <div className="min-w-0">
              <div className="text-sm font-medium">直接移动（走不动时开）</div>
              <p className="text-[11px] leading-relaxed text-muted">
                模组服里物理算不动、bot 走不了路时开启：改为直接发坐标包让它走（和 MCC 一个原理），不依赖物理。普通服不用开。
              </p>
            </div>
            <Switch checked={rawMove} onChange={setRawMove} />
          </div>
        </div>

        {err && <div className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{err}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isEdit ? "保存修改" : "添加并连接"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
