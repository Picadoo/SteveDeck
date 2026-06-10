import Modal from "@/components/ui/Modal";
import Viewer from "./Viewer";
import QuickCommands from "./QuickCommands";
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
      <Viewer bot={bot} popout autoStart frameClass="h-[clamp(300px,62vh,820px)]" />
      {/* 放大时底部快捷指令条被遮住，这里补一份——边看边一键发常用命令 */}
      <div className="mt-2">
        <QuickCommands bot={bot} />
      </div>
    </Modal>
  );
}
