import Modal from "@/components/ui/Modal";
import Viewer from "./Viewer";
import type { BotSummary } from "@mcbot/protocol";

/** 实时视角「放大」窗口：全屏 Modal 包同一个 Viewer 组件（与现场页内嵌零重复）。 */
export default function ViewerModal({
  bot,
  open,
  onClose,
}: {
  bot: BotSummary;
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title={`${bot.username} · 实时视角`} size="full">
      <Viewer bot={bot} popout autoStart frameClass="h-[68vh]" />
    </Modal>
  );
}
