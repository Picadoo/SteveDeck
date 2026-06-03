import { useEffect, useState } from "react";
import Modal from "@/components/ui/Modal";
import { cmd } from "@/lib/engine";
import { useStore } from "@/store/useStore";
import type { BotSummary } from "@mcbot/protocol";

/** 机器人实时视角（prismarine-viewer web，浏览器端渲染，按需启停） */
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

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setUrl(null);
    cmd.viewer.start(bot.id).then((r) => {
      if (cancelled) return;
      setLoading(false);
      if (r.ok && r.data?.port) {
        const host = connUrl.replace(/^https?:\/\//, "").replace(/:\d+$/, "");
        setUrl(`http://${host}:${r.data.port}`);
      } else {
        pushToast(r.error || "视角启动失败", "error");
      }
    });
    return () => {
      cancelled = true;
      cmd.viewer.stop(bot.id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bot.id]);

  return (
    <Modal open={open} onClose={onClose} title={`${bot.username} · 实时视角`}>
      <div className="h-[58vh] w-full overflow-hidden rounded-lg border border-border bg-black">
        {url ? (
          <iframe src={url} className="h-full w-full border-0" title="bot-view" allow="fullscreen" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            {loading ? "正在启动视角…" : "未启动"}
          </div>
        )}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        浏览器端渲染机器人第一人称画面，关闭即停止、不占资源（按需，不高频）。远程引擎需该端口可达。
      </p>
    </Modal>
  );
}
