import { useEffect, useState } from "react";
import { User, Users, Send } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { Button, Input } from "@/components/ui/primitives";
import { cmd } from "@/lib/engine";
import { useStore } from "@/store/useStore";
import { healthPct } from "@/lib/format";
import type { BotSummary } from "@mcbot/protocol";

/** 机器人实时视角：第三人称(可点地面走) / 第一人称(镜头跟随最稳) + 坐标浮层 + 边看边发指令 */
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
        {/* 坐标 / 状态浮层 */}
        {pos && (
          <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/55 px-2 py-1 font-mono text-[11px] text-white shadow">
            XYZ {pos.x}, {pos.y}, {pos.z} · ❤ {pct ?? "-"}% · 🍗 {bot.food ?? "-"}
          </div>
        )}
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
