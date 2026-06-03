import { RefreshCw } from "lucide-react";
import { useStore } from "@/store/useStore";
import { cmd } from "@/lib/engine";
import Modal from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import type { BotSummary, WindowSlot } from "@mcbot/protocol";

/** 服务器打开的窗口/GUI（箱子、菜单）——点击槽位即操作 */
export default function GuiWindow({ bot }: { bot: BotSummary }) {
  const win = useStore((s) => s.windows[bot.username]);
  if (!win) return null;

  const setWin = useStore.getState().setWindow;
  const close = () => {
    cmd.window.close(bot.id);
    setWin(bot.username, null);
  };
  const click = async (slot: number, button = 0) => {
    const r = await cmd.window.click(bot.id, slot, button, 0);
    if (r.ok) setWin(bot.username, r.data ?? null);
  };
  const refresh = async () => {
    const r = await cmd.window.get(bot.id);
    if (r.ok) setWin(bot.username, r.data ?? null);
  };

  const total = win.slotCount;
  const split =
    win.inventoryStart && win.inventoryStart > 0 && win.inventoryStart < total
      ? win.inventoryStart
      : total;
  const container = win.slots.slice(0, split);
  const backpack = win.slots.slice(split);

  return (
    <Modal
      open
      onClose={close}
      title={win.title}
      footer={
        <>
          <Button variant="ghost" onClick={refresh}>
            <RefreshCw className="h-3.5 w-3.5" /> 刷新
          </Button>
          <Button variant="secondary" onClick={close}>
            关闭界面
          </Button>
        </>
      }
    >
      <p className="mb-2 text-[11px] text-muted">左键点击操作 · 右键 = 右键点击（菜单按钮直接点即可）</p>
      <SlotGrid slots={container} onClick={click} />
      {split < total && backpack.length > 0 && (
        <>
          <div className="my-2 text-[11px] font-medium text-muted">你的背包</div>
          <SlotGrid slots={backpack} base={split} onClick={click} />
        </>
      )}
    </Modal>
  );
}

function SlotGrid({
  slots,
  base = 0,
  onClick,
}: {
  slots: (WindowSlot | null)[];
  base?: number;
  onClick: (slot: number, button?: number) => void;
}) {
  return (
    <div className="grid grid-cols-9 gap-1">
      {slots.map((it, i) => {
        const slotIdx = base + i;
        const filler = !!it && /glass_pane|stained_glass/i.test(it.id || "");
        const tip = it
          ? `${it.name}${it.count > 1 ? ` ×${it.count}` : ""}` +
            (it.enchants && it.enchants.length ? "\n" + it.enchants.join("、") : "") +
            (it.lore ? "\n" + it.lore : "")
          : undefined;
        return (
          <button
            key={slotIdx}
            onClick={() => onClick(slotIdx, 0)}
            onContextMenu={(e) => {
              e.preventDefault();
              onClick(slotIdx, 1);
            }}
            disabled={!it}
            title={tip}
            className={cn(
              "relative flex aspect-square items-center justify-center rounded border p-0.5 text-center transition-colors",
              !it
                ? "cursor-default border-border/40 bg-surface-2/30"
                : filler
                  ? "border-border/30 bg-surface-2/40 opacity-40 hover:opacity-80"
                  : "border-border bg-surface-2 hover:border-accent hover:bg-accent/10",
            )}
          >
            {it && !filler && (
              <span className="line-clamp-2 break-all text-[8px] leading-tight text-fg">{it.name}</span>
            )}
            {it && it.count > 1 && (
              <span className="absolute bottom-0 right-0.5 text-[9px] font-bold text-fg">{it.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
