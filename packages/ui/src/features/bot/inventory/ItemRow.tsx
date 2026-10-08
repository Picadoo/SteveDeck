// 背包列表的单行物品（操作按钮 + 跟随光标的悬浮详情）。从 InventoryTab 拆出。
// memo：BotPanel 每 2s 收到状态推送会整树重渲，背包未变时 36 行直接跳过
// （item 对象在两次背包同步之间引用稳定；onUse/onReadBook 上游已保证引用稳定）
import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Shirt, Hand, Shield, BookOpen, MousePointerClick, Trash2 } from "lucide-react";
import McText from "@/components/McText";
import { ItemIcon } from "@/components/ItemIcon";
import { useStore } from "@/store/useStore";
import { cmd } from "@/lib/engine";
import { useConfirmClick } from "@/lib/useConfirmClick";
import { cn } from "@/lib/cn";
import { MC_TIP_CLASS, McItemTipBody } from "./McItemTip";
import type { UseAction } from "./itemUsage";
import type { InventoryItem } from "@mcbot/protocol";

const isArmor = (texture?: string) => /(_helmet|_chestplate|_leggings|_boots)$|^elytra$/.test(texture || "");

const ItemRow = memo(function ItemRow({
  item,
  botId,
  online,
  full,
  texBase,
  onUse,
  onReadBook,
  sneakRef,
}: {
  item: InventoryItem;
  botId: string;
  online: boolean;
  full: boolean;
  texBase: string;
  onUse: (item: InventoryItem, action: UseAction) => void;
  onReadBook: (slot: number) => void;
  sneakRef: React.RefObject<boolean>;
}) {
  const pushToast = useStore((s) => s.pushToast);
  const [tipOpen, setTipOpen] = useState(false);
  const tipRef = useRef<HTMLDivElement>(null);
  const act = async (action: "equip" | "hold" | "use" | "drop" | "offhand") => {
    const extra = action === "use" && sneakRef.current ? { sneak: true } : {};
    const r = await cmd.moduleAction(botId, "inventory", action, { slot: item.slot, ...extra });
    if (!r.ok) pushToast(r.error || "操作失败", "error");
    // 丢弃/放副手/挪格子不算「使用」，其余计入常用
    else if (action === "equip" || action === "hold" || action === "use") onUse(item, action);
  };
  // 丢弃整组不可恢复：两段确认（第一次点变「确认?」，2.5s 内再点才丢）。
  // resetKey=物品身份：行按槽位复用，确认窗口内物品滑动换位（拾取/清理高频）必须重新确认。
  const confirmDrop = useConfirmClick(
    () => void act("drop"),
    2500,
    `${item.name}|${item.display}|${item.texture}|${item.count}`,
  );
  const armor = isArmor(item.texture);
  // 可翻看的书：成书（只读）/ 书与笔（可编辑）。附魔书没有页面，不算
  const book = item.texture === "written_book" || item.texture === "writable_book";
  const name = item.display || item.name || "";
  const hasTip = full && (!!item.lore || (item.enchants?.length ?? 0) > 0 || !!item.texture);

  // UIFEAT-6 v2：跟随光标改为 transform 直写 DOM——mousemove 全程零 React 渲染、零布局抖动。
  // 尺寸只在提示框打开时测一次（sizeRef），之后每帧只算坐标 + 改 transform（合成器搞定）。
  const rafRef = useRef<number | null>(null);
  const posRef = useRef({ x: 0, y: 0 });
  const sizeRef = useRef({ w: 0, h: 0 });
  const place = () => {
    const el = tipRef.current;
    if (!el) return;
    const { x, y } = posRef.current;
    const { w, h } = sizeRef.current;
    const m = 10;
    const safeBottom = window.innerHeight - 76;
    let left = x + 16;
    if (left + w > window.innerWidth - m) left = Math.max(m, x - w - 16);
    let top = y + 16;
    if (top + h > safeBottom) top = y - h - 12;
    if (top < m) top = m;
    el.style.transform = `translate(${left}px, ${top}px)`;
  };
  const onMove = (e: { clientX: number; clientY: number }) => {
    posRef.current = { x: e.clientX, y: e.clientY };
    if (!tipOpen) {
      setTipOpen(true); // 初次打开：渲染后由 useLayoutEffect 测量定位
      return;
    }
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      place();
    });
  };
  useLayoutEffect(() => {
    if (!tipOpen) return;
    const el = tipRef.current;
    if (!el) return;
    sizeRef.current = { w: el.offsetWidth, h: el.offsetHeight };
    place();
    el.style.visibility = "visible"; // 测量定位完再显示，避免左上角闪一帧
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipOpen]);
  const closeTimer = useRef<number | null>(null);
  const clearTip = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setTipOpen(false);
  };
  // 关闭宽限期：鼠标从物品行移到提示框的瞬间会短暂离开行；150ms 内进入提示框则取消关闭，
  // 于是长 lore（RPG 物品）可以把鼠标移上去滚动看全（提示框 pointer-events 打开 + 可滚动）。
  const scheduleClose = () => {
    if (closeTimer.current != null) return;
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      clearTip();
    }, 150);
  };
  const cancelClose = () => {
    if (closeTimer.current != null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    if (closeTimer.current != null) clearTimeout(closeTimer.current);
  }, []);

  return (
    <div
      className={cn(
        "group flex items-start gap-2.5 rounded-lg px-3 py-2",
        item.held ? "bg-accent/10 ring-1 ring-accent/40" : "bg-surface-2/50",
      )}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 悬停展示物品提示的热区，无点击语义 */}
      <div
        className="flex min-w-0 flex-1 items-start gap-2.5"
        onMouseMove={hasTip ? onMove : undefined}
        onMouseEnter={hasTip ? cancelClose : undefined}
        onMouseLeave={hasTip ? scheduleClose : undefined}
      >
        {full && <ItemIcon texture={item.texture} base={texBase} size={32} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">
              <McText text={name} />
            </span>
            {item.count && item.count > 1 && (
              <span className="shrink-0 text-[11px] text-muted">×{item.count}</span>
            )}
          </div>
          {item.enchants && item.enchants.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {item.enchants.map((e) => (
                <span key={e} className="rounded bg-accent/12 px-1.5 py-px text-[10px] text-accent">
                  {e}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {tipOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: 悬浮提示的悬停保持（防止移入提示时消失），无点击语义
        <div
          ref={tipRef}
          onMouseEnter={cancelClose}
          onMouseLeave={clearTip}
          className={cn("invisible fixed left-0 top-0 z-[100] max-h-[55vh] max-w-[18rem] overflow-y-auto overscroll-contain", MC_TIP_CLASS)}
        >
          <McItemTipBody name={name} count={item.count} enchants={item.enchants} lore={item.lore} texture={item.texture} />
        </div>
      )}
      {online && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
          {armor && (
            <SlotBtn title="穿戴（护甲槽）" onClick={() => act("equip")}>
              <Shirt className="h-3.5 w-3.5" />
            </SlotBtn>
          )}
          <SlotBtn title="拿在手上" onClick={() => act("hold")}>
            <Hand className="h-3.5 w-3.5" />
          </SlotBtn>
          <SlotBtn title="放到副手" onClick={() => act("offhand")}>
            <Shield className="h-3.5 w-3.5" />
          </SlotBtn>
          {book && (
            <SlotBtn title={item.texture === "writable_book" ? "翻看 / 编辑（书与笔）" : "翻看"} onClick={() => onReadBook(item.slot)}>
              <BookOpen className="h-3.5 w-3.5 text-accent" />
            </SlotBtn>
          )}
          {!armor && (
            <SlotBtn title="使用（右键）" onClick={() => act("use")}>
              <MousePointerClick className="h-3.5 w-3.5" />
            </SlotBtn>
          )}
          <SlotBtn title={confirmDrop.arming ? "再点一次确认丢弃" : "丢弃整组"} onClick={confirmDrop.onClick}>
            {confirmDrop.arming ? (
              <span className="text-[10px] font-medium text-danger">确认?</span>
            ) : (
              <Trash2 className="h-3.5 w-3.5 text-danger" />
            )}
          </SlotBtn>
        </div>
      )}
      <span className="shrink-0 pt-0.5 text-[10px] text-muted/50 tabular-nums">#{item.slot}</span>
    </div>
  );
});

function SlotBtn({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="rounded p-1.5 text-muted transition hover:bg-surface hover:text-fg active:scale-90"
    >
      {children}
    </button>
  );
}

export default ItemRow;
