// 整理背包：常驻 MC 布局界面。从 InventoryTab 拆出。
// - 点一件物品=选中（高亮），再点目标格=移动/交换，界面不关，可一直整理；
// - 悬浮任意物品显示完整 ItemTip（名字/数量/附魔/lore/物品 id）；
// - 数据来自 store 实时背包，每次移动后引擎广播自动刷新格子。
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Modal from "@/components/ui/Modal";
import McText from "@/components/McText";
import { ItemIcon } from "@/components/ItemIcon";
import { useStore } from "@/store/useStore";
import { cmd } from "@/lib/engine";
import { cn } from "@/lib/cn";
import { MC_TIP_CLASS, McItemTipBody } from "./McItemTip";
import type { InventoryItem } from "@mcbot/protocol";

/** 整理面板的单个格子：模块级 memo——只有自身 props 变才重渲，悬浮提示/选中切换不再波及全盘 */
const OrgCell = memo(function OrgCell({
  slot,
  label,
  it,
  isSel,
  anySel,
  busy,
  texBase,
  onClick,
  onEnter,
  onLeave,
}: {
  slot: number;
  label?: string;
  it: InventoryItem | undefined;
  isSel: boolean;
  anySel: boolean;
  busy: boolean;
  texBase: string;
  onClick: (slot: number) => void;
  onEnter: (it: InventoryItem, el: HTMLElement) => void;
  onLeave: () => void;
}) {
  return (
    <button
      disabled={busy}
      onClick={() => onClick(slot)}
      onMouseEnter={it ? (e) => onEnter(it, e.currentTarget) : undefined}
      onMouseLeave={it ? onLeave : undefined}
      aria-label={it ? `格子 ${slot}：${it.display || it.name || "物品"}` : `空格子 ${slot}${label ? `（${label}）` : ""}`}
      className={cn(
        "relative flex h-10 w-10 items-center justify-center rounded border text-[9px] transition-colors",
        isSel
          ? "border-accent bg-accent/25 ring-2 ring-accent"
          : it
            ? cn("border-border bg-surface-2/70", anySel ? "hover:border-warning hover:bg-warning/10" : "hover:border-accent hover:bg-accent/10")
            : cn("border-border/50 bg-surface-2/25", anySel && "hover:border-accent hover:bg-accent/10"),
        it?.held && !isSel && "ring-1 ring-accent/50",
      )}
    >
      {it ? (
        <>
          <ItemIcon texture={it.texture} base={texBase} size={26} />
          {it.count && it.count > 1 && (
            <span className="absolute bottom-0 right-0.5 text-[9px] font-semibold text-white" style={{ textShadow: "1px 1px 0 #000" }}>
              {it.count}
            </span>
          )}
        </>
      ) : (
        <span className="text-muted/40">{label ?? ""}</span>
      )}
    </button>
  );
});

export default function OrganizeDialog({
  botId,
  items,
  texBase,
  initialSel,
  onClose,
}: {
  botId: string;
  items: InventoryItem[];
  texBase: string;
  initialSel?: number;
  onClose: () => void;
}) {
  const pushToast = useStore((s) => s.pushToast);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<number | null>(initialSel ?? null);
  // 性能要点（原版「有点卡」的根因）：
  // - 提示锚定在格子上（mouseenter 一次），不再跟随鼠标——mousemove 零开销；
  // - OrgCell 是模块级 memo 组件（原来定义在本函数体内，每次渲染都是新类型 → 41 格全量卸载重建）。
  const [tip, setTip] = useState<{ it: InventoryItem; rect: DOMRect } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [tipStyle, setTipStyle] = useState<CSSProperties>({ left: -9999, top: -9999 });
  useLayoutEffect(() => {
    if (!tip || !tipRef.current) return;
    const el = tipRef.current;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const m = 10;
    const r = tip.rect;
    // 放格子「侧边」而非上下方——浮在上方/下方会盖住正在查看或想点的相邻格子行。
    // 优先右侧；右侧放不下 → 左侧；垂直与格子顶部对齐并夹在视口内，不覆盖格子网格。
    let left = r.right + 8;
    if (left + w > window.innerWidth - m) left = r.left - w - 8;
    left = Math.min(Math.max(m, left), window.innerWidth - w - m);
    const top = Math.min(Math.max(m, r.top), window.innerHeight - h - m);
    setTipStyle({ left, top, maxHeight: window.innerHeight - 2 * m });
  }, [tip]);
  const onCellEnter = useCallback((it: InventoryItem, el: HTMLElement) => {
    setTip({ it, rect: el.getBoundingClientRect() });
  }, []);
  const onCellLeave = useCallback(() => setTip(null), []);
  const bySlot = useMemo(() => {
    const m = new Map<number, InventoryItem>();
    for (const it of items) if (it.name) m.set(it.slot, it);
    return m;
  }, [items]);
  // 选中的格子被移走/变化后自动取消选中（移动成功后源格大概率已空）
  useEffect(() => {
    if (sel !== null && !bySlot.get(sel)) setSel(null);
  }, [bySlot, sel]);

  const clickCell = useCallback(
    async (slot: number) => {
      if (busy) return;
      const it = bySlot.get(slot);
      if (sel === null) {
        if (it) setSel(slot); // 空手点空格无意义，忽略
        return;
      }
      if (sel === slot) {
        setSel(null);
        return;
      }
      setBusy(true);
      const r = await cmd.moduleAction(botId, "inventory", "move", { from: sel, to: slot });
      setBusy(false);
      if (r.ok) {
        setSel(null); // 留在界面里继续整理
      } else {
        pushToast(r.error || "移动失败", "error");
      }
    },
    [busy, sel, bySlot, botId, pushToast],
  );

  // 关键：用「返回元素的函数」而非「内联组件」渲染格子。
  // 内联组件（const Cell = () => …）每次父渲染都是新函数引用 → React 视作新组件类型 →
  // 全部 OrgCell 卸载重建；于是 hover→setTip→重渲→格子 DOM 重建→鼠标又触发 hover→…无限重建，
  // 点击落在正在重建的 DOM 上 → 「显示 lore 后点不动格子」。改成函数返回 <OrgCell> 元素，
  // OrgCell 是稳定的模块级 memo 组件，按 props 正常 reconcile，不再整树重建。
  const cell = (slot: number, label?: string) => (
    <OrgCell
      key={slot}
      slot={slot}
      label={label}
      it={bySlot.get(slot)}
      isSel={slot === sel}
      anySel={sel !== null}
      busy={busy}
      texBase={texBase}
      onClick={clickCell}
      onEnter={onCellEnter}
      onLeave={onCellLeave}
    />
  );

  const selItem = sel !== null ? bySlot.get(sel) : null;
  return (
    <Modal open onClose={onClose} title="整理背包" size="lg">
      <div className="space-y-3">
        <p className="min-h-[18px] text-[11px] text-muted">
          {selItem ? (
            <>
              已选中 <McText text={selItem.display || selItem.name || ""} />（#{sel}）——点目标格：空格=移过去，占用格=交换；再点自己=取消
            </>
          ) : (
            "点一件物品选中，再点目标格子移动/交换；可以一直留在这里整理，悬浮看物品详情"
          )}
        </p>
        <div>
          <div className="mb-1 text-[11px] font-medium text-muted">装备 / 副手</div>
          <div className="flex gap-1">
            {cell(5, "头")}
            {cell(6, "胸")}
            {cell(7, "腿")}
            {cell(8, "脚")}
            <span className="mx-1 self-center text-muted/30">|</span>
            {cell(45, "副手")}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[11px] font-medium text-muted">背包</div>
          <div className="grid w-fit grid-cols-9 gap-1">
            {Array.from({ length: 27 }, (_, i) => cell(9 + i))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[11px] font-medium text-muted">快捷栏（高亮圈=当前手持）</div>
          <div className="grid w-fit grid-cols-9 gap-1">
            {Array.from({ length: 9 }, (_, i) => cell(36 + i))}
          </div>
        </div>
      </div>

      {/* ItemTip：完整物品信息（锚定格子侧边，超长限高滚动；测量定位见上方 useLayoutEffect） */}
      {tip && (
        <div
          ref={tipRef}
          className={cn("pointer-events-none fixed z-[120] max-w-[20rem] overflow-y-auto", MC_TIP_CLASS)}
          style={tipStyle}
        >
          <McItemTipBody
            name={tip.it.display || tip.it.name || ""}
            count={tip.it.count}
            enchants={tip.it.enchants}
            lore={tip.it.lore}
            texture={tip.it.texture}
            slot={tip.it.slot}
          />
        </div>
      )}
    </Modal>
  );
}
