import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { RefreshCw, Hand } from "lucide-react";
import { useStore } from "@/store/useStore";
import { cmd } from "@/lib/engine";
import Modal from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import McText from "@/components/McText";
import { ItemIcon } from "@/components/ItemIcon";
import { cn } from "@/lib/cn";
import type { BotSummary, WindowSlot } from "@mcbot/protocol";

type Hover = { it: WindowSlot; x: number; y: number };

// 数字描边（仿原版数量角标）
const NUM_SHADOW = "1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000";

/** 服务器打开的窗口/GUI（箱子、菜单）——贴图网格、悬浮看完整信息、点击即操作 */
export default function GuiWindow({ bot }: { bot: BotSummary }) {
  const win = useStore((s) => s.windows[bot.id]);
  const connUrl = useStore((s) => s.conn.url);
  const [hover, setHover] = useState<Hover | null>(null);

  // 刷新/切换账号后自动恢复：若服务端此刻有打开的窗口，拉回来重新弹出
  // （预览是静态构建包，刷新会丢失前端窗口状态；服务端的窗口仍在）
  useEffect(() => {
    if (!bot.online) return;
    let cancelled = false;
    (async () => {
      if (useStore.getState().windows[bot.id]) return; // 已有则不覆盖
      const r = await cmd.window.get(bot.id);
      if (!cancelled && r.ok && r.data) useStore.getState().setWindow(bot.id, r.data);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.id, bot.online]);

  // UIFEAT-6：hover 每像素 setState（+ItemTip 重算布局）→ rAF 合并到每帧最多一次；离开立即应用。
  const hoverRafRef = useRef<number | null>(null);
  const hoverRef = useRef<Hover | null>(null);
  const onHover = (h: Hover | null) => {
    hoverRef.current = h;
    if (h === null) {
      if (hoverRafRef.current != null) {
        cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = null;
      }
      setHover(null);
      return;
    }
    if (hoverRafRef.current != null) return;
    hoverRafRef.current = requestAnimationFrame(() => {
      hoverRafRef.current = null;
      setHover(hoverRef.current);
    });
  };
  useEffect(() => () => {
    if (hoverRafRef.current != null) cancelAnimationFrame(hoverRafRef.current);
  }, []);

  if (!win) return null;

  const texBase = `${connUrl.replace(/\/+$/, "")}/textures/${bot.version || "1.12.2"}`;
  const setWin = useStore.getState().setWindow;
  const close = () => {
    cmd.window.close(bot.id);
    setWin(bot.id, null);
  };
  const click = async (slot: number, button = 0, mode = 0) => {
    setHover(null);
    const r = await cmd.window.click(bot.id, slot, button, mode);
    if (r.ok) setWin(bot.id, r.data ?? null);
  };
  const refresh = async () => {
    const r = await cmd.window.get(bot.id);
    if (r.ok) setWin(bot.id, r.data ?? null);
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
      size="lg"
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
      <p className="mb-2.5 text-[11px] text-muted">
        左键点/拿起 · 右键拿一半/放一个 · Shift+左键快速移动 · 悬浮看详情（菜单按钮直接点即可）
      </p>
      {/* 光标上拿着的物品：拿起后显示在此，点任意目标格即放下，可放进符文/宝石镶嵌等指定孔位 */}
      {win.cursor && (
        <div className="mb-2.5 flex items-center gap-2 rounded-lg border border-accent/50 bg-accent/10 px-3 py-2">
          <Hand className="h-4 w-4 shrink-0 text-accent" />
          <span className="shrink-0 text-[11px] font-medium text-accent">手里拿着</span>
          <ItemIcon texture={win.cursor.id} base={texBase} size={24} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            <McText text={win.cursor.display || win.cursor.name} />
            {win.cursor.count > 1 && <span className="ml-1 text-[11px] text-muted">×{win.cursor.count}</span>}
          </span>
          <span className="hidden shrink-0 text-[10px] text-muted sm:inline">点目标格放下 · 右键放一个</span>
        </div>
      )}
      <SlotGrid slots={container} texBase={texBase} onClick={click} onHover={onHover} />
      {split < total && backpack.length > 0 && (
        <>
          <div className="mb-1.5 mt-3 text-[11px] font-medium text-muted">你的背包</div>
          <SlotGrid slots={backpack} base={split} texBase={texBase} onClick={click} onHover={onHover} />
        </>
      )}
      {hover && <ItemTip hover={hover} />}
    </Modal>
  );
}

function SlotGrid({
  slots,
  base = 0,
  texBase,
  onClick,
  onHover,
}: {
  slots: (WindowSlot | null)[];
  base?: number;
  texBase: string;
  onClick: (slot: number, button?: number, mode?: number) => void;
  onHover: (h: Hover | null) => void;
}) {
  return (
    <div className="grid grid-cols-9 gap-1">
      {slots.map((it, i) => {
        const slotIdx = base + i;
        // 菜单里常见的玻璃板/有色玻璃只是装饰边框，弱化显示、不参与悬浮
        const filler = !!it && /glass_pane|stained_glass/i.test(it.id || "");
        const active = !!it && !filler;
        return (
          <button
            key={slotIdx}
            onClick={(e) => onClick(slotIdx, 0, e.shiftKey ? 1 : 0)}
            onContextMenu={(e) => {
              e.preventDefault();
              onClick(slotIdx, 1, 0);
            }}
            onMouseMove={active ? (e) => onHover({ it: it!, x: e.clientX, y: e.clientY }) : undefined}
            onMouseLeave={active ? () => onHover(null) : undefined}
            disabled={!it}
            className={cn(
              "relative flex aspect-square items-center justify-center rounded border p-0.5 transition-colors",
              !it
                ? "cursor-default border-border/30 bg-surface-2/20"
                : filler
                  ? "cursor-default border-border/20 bg-surface-2/30 opacity-60"
                  : "border-border bg-surface-2/70 hover:border-accent hover:bg-accent/10",
            )}
          >
            {/* 渲染所有有 id 的物品(含玻璃板边框，贴图弱化显示)；悬浮仍只给非装饰项 */}
            {/* fill：9 列格子随屏宽缩放（手机竖屏整屏放下不溢出），桌面封顶 30px 维持原样 */}
            {it && <ItemIcon texture={it.id} base={texBase} size={30} fill />}
            {it && it.count > 1 && (
              <span
                className="pointer-events-none absolute -bottom-px right-0.5 text-[10px] font-bold tabular-nums text-white"
                style={{ textShadow: NUM_SHADOW }}
              >
                {it.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** MC 风格悬浮看板：彩色名 + 附魔 + 完整 Lore + 物品 id；跟随光标、自适应不被截断 */
function ItemTip({ hover }: { hover: Hover }) {
  const { it } = hover;
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ left: -9999, top: -9999 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const m = 12;
    const safeBottom = window.innerHeight - m;
    let left = hover.x + 16;
    if (left + w > window.innerWidth - m) left = Math.max(m, hover.x - w - 16);
    let top = hover.y + 16;
    if (top + h > safeBottom) top = hover.y - h - 12;
    if (top < m) top = m;
    setStyle({ left, top, maxHeight: safeBottom - top });
  }, [hover.x, hover.y, it]);

  const name = it.display || it.name || "";
  return (
    <div
      ref={ref}
      className="pointer-events-none fixed z-[100] max-w-[18rem] overflow-hidden rounded border border-[#34106b] bg-[#100016]/95 px-2.5 py-2 shadow-xl"
      style={style}
    >
      <div className="text-sm font-semibold leading-snug">
        <McText text={name} onDark />
        {it.count > 1 ? (
          <span className="ml-1 text-[11px] font-normal text-white/50">×{it.count}</span>
        ) : null}
      </div>
      {it.enchants && it.enchants.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {it.enchants.map((e, i) => (
            <div key={i} className="text-[11px] text-[#9d8bff]">
              {e}
            </div>
          ))}
        </div>
      )}
      {it.lore && (
        <div className="mt-1 whitespace-pre-line text-[11px] leading-snug text-white/75">
          <McText text={it.lore} onDark />
        </div>
      )}
      {it.id && <div className="mt-1.5 text-[10px] text-white/30">minecraft:{it.id}</div>}
    </div>
  );
}
