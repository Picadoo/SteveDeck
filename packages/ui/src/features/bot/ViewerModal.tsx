import { useEffect, useState } from "react";
import { User, Users, Send, Heart, Drumstick, MapPin } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { Button, Input } from "@/components/ui/primitives";
import { cmd } from "@/lib/engine";
import { useStore } from "@/store/useStore";
import { healthPct } from "@/lib/format";
import { MODULES } from "./moduleDefs";
import { cn } from "@/lib/cn";
import type { BotSummary } from "@mcbot/protocol";

// 视角里可一键开关的「快速验证」模块：边看 3D 边切，立刻看效果
const QUICK_KEYS = ["combat", "fishing", "mob_hunter"];
const QUICK_MODULES = QUICK_KEYS.map((k) => MODULES.find((m) => m.key === k)).filter(
  (m): m is (typeof MODULES)[number] => !!m,
);

/** 机器人实时视角：第三人称(可点地面走) / 第一人称(镜头跟随最稳) + 坐标浮层 + 模块快速开关 + 边看边发指令 */
export default function ViewerModal({
  bot,
  open,
  onClose,
}: {
  bot: BotSummary;
  open: boolean;
  onClose: () => void;
}) {
  const connUrl = useStore((s) => s.conn.url);
  const pushToast = useStore((s) => s.pushToast);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [firstPerson, setFirstPerson] = useState(false);
  const [cmdText, setCmdText] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setUrl(null);
    cmd.viewer.start(bot.id, firstPerson).then((r) => {
      if (cancelled) return;
      setLoading(false);
      if (r.ok && r.data?.port) {
        const host = connUrl.replace(/^https?:\/\//, "").replace(/:\d+$/, "");
        setUrl(`http://${host}:${r.data.port}?fp=${firstPerson ? 1 : 0}`);
      } else {
        pushToast(r.error || "视角启动失败", "error");
      }
    });
    return () => {
      cancelled = true;
      cmd.viewer.stop(bot.id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bot.id, firstPerson]);

  const pos = bot.pos;
  const pct = healthPct(bot);

  async function send() {
    const m = cmdText.trim();
    if (!m) return;
    setCmdText("");
    await cmd.chat(bot.id, m);
  }
  function toggleModule(key: string, active: boolean) {
    cmd.toggleModule(bot.id, key, active).then((r) => {
      if (!r.ok) pushToast(r.error || "操作失败", "error");
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${bot.username} · 实时视角`}
      footer={
        <>
          <Button variant="ghost" onClick={() => setFirstPerson((v) => !v)}>
            {firstPerson ? (
              <>
                <Users className="h-3.5 w-3.5" /> 切第三人称
              </>
            ) : (
              <>
                <User className="h-3.5 w-3.5" /> 切第一人称
              </>
            )}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            关闭
          </Button>
        </>
      }
    >
      <div className="relative h-[52vh] w-full overflow-hidden rounded-lg border border-border bg-black">
        {url ? (
          <iframe src={url} className="h-full w-full border-0" title="bot-view" allow="fullscreen" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            {loading ? "正在启动视角…" : "未启动"}
          </div>
        )}
        {/* 坐标 / 状态浮层（lucide 图标，匹配整体界面） */}
        {pos && (
          <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-2.5 rounded-md bg-black/55 px-2.5 py-1 font-mono text-[11px] text-white shadow">
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3 text-emerald-400" />
              {pos.x}, {pos.y}, {pos.z}
            </span>
            <span className="flex items-center gap-1">
              <Heart className="h-3 w-3 text-rose-400" />
              {pct ?? "-"}%
            </span>
            <span className="flex items-center gap-1">
              <Drumstick className="h-3 w-3 text-amber-400" />
              {bot.food ?? "-"}
            </span>
          </div>
        )}
      </div>

      {/* 模块快速开关：边看边切，立刻验证效果 */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {QUICK_MODULES.map((def) => {
          const Icon = def.icon;
          const active = !!bot.modules[def.activeFlag];
          return (
            <button
              key={def.key}
              type="button"
              disabled={!bot.online}
              onClick={() => toggleModule(def.key, !active)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40",
                active
                  ? "border-accent/40 bg-accent/15 text-accent"
                  : "border-border bg-surface-2/50 text-muted hover:text-fg",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {def.name}
              <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-accent" : "bg-muted/40")} />
            </button>
          );
        })}
      </div>

      {/* 边看边发指令 */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="mt-2 flex gap-2"
      >
        <Input
          value={cmdText}
          onChange={(e) => setCmdText(e.target.value)}
          placeholder="边看边发指令 / 聊天…"
          disabled={!bot.online}
        />
        <Button type="submit" variant="primary" disabled={!bot.online || !cmdText.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        第三人称：点画面里的地面，机器人会走过去；第一人称：镜头=机器人视线，跟随最稳。关闭即停。
      </p>
    </Modal>
  );
}
