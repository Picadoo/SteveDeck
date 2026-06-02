import { useState, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { Button, Input } from "@/components/ui/primitives";
import { cmd } from "@/lib/engine";

const EMPTY = { username: "", host: "", port: "25565", version: "1.20.1", loginPassword: "" };

export default function AddBotDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
    const res = await cmd.addBot({
      username: form.username.trim(),
      host: form.host.trim(),
      port: Number(form.port) || 25565,
      version: form.version.trim() || undefined,
      loginPassword: form.loginPassword || undefined,
    });
    setBusy(false);
    if (res.ok) {
      setForm({ ...EMPTY });
      onClose();
    } else {
      setErr(res.error || "添加失败");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="添加机器人">
      <form onSubmit={submit} className="space-y-3.5">
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="游戏版本">
            <Input value={form.version} onChange={(e) => set("version", e.target.value)} placeholder="1.20.1" />
          </Field>
          <Field label="登录密码（可选）">
            <Input type="password" value={form.loginPassword} onChange={(e) => set("loginPassword", e.target.value)} placeholder="/login 用" />
          </Field>
        </div>

        {err && <div className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{err}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            添加并连接
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
