import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { RefreshCw, Package, Shirt, Hand, Trash2, MousePointerClick, Star, X, Shield, LayoutGrid, BookOpen, ChevronLeft, ChevronRight, Loader2, Plus, ArrowDownToLine } from "lucide-react";
import { useStore } from "@/store/useStore";
import { cmd } from "@/lib/engine";
import { Button } from "@/components/ui/primitives";
import Modal from "@/components/ui/Modal";
import McText from "@/components/McText";
import { ItemIcon } from "@/components/ItemIcon";
import { mcPlain } from "@/lib/format";
import { useConfirmClick } from "@/lib/useConfirmClick";
import { cn } from "@/lib/cn";
import type { BotSummary, InventoryItem } from "@mcbot/protocol";

// 模块级稳定空数组：避免 zustand v5 选择器返回新引用导致无限重渲染
const EMPTY_ITEMS: InventoryItem[] = [];

type Cat = "equip" | "hotbar" | "main";
const CAT_LABEL: Record<Cat, string> = { equip: "装备", hotbar: "快捷栏", main: "背包" };
// 顺序：快捷栏 → 背包 → 装备（装备不再排第一）；最上面是自创的「常用」栏
const CAT_ORDER: Cat[] = ["hotbar", "main", "equip"];

function categorize(slot: number): Cat | null {
  if ((slot >= 5 && slot <= 8) || slot === 45) return "equip";
  if (slot >= 36 && slot <= 44) return "hotbar";
  if (slot >= 9 && slot <= 35) return "main";
  return null; // 合成格等忽略
}

const isArmor = (texture?: string) => /(_helmet|_chestplate|_leggings|_boots)$|^elytra$/.test(texture || "");

// ============ 「常用」栏：按使用频率记账（纯前端 localStorage，按 bot 维度，不碰原版槽位） ============
type UseAction = "equip" | "hold" | "use";
interface UsageEntry {
  key: string;
  display: string; // 原始展示名（带色码）
  texture?: string;
  count: number;
  lastUsed: number;
  lastAction: UseAction;
}
type UsageMap = Record<string, UsageEntry>;

const ACTION_ICON: Record<UseAction, typeof Hand> = { equip: Shirt, hold: Hand, use: MousePointerClick };
const ACTION_LABEL: Record<UseAction, string> = { equip: "穿戴", hold: "持有", use: "使用" };

// 身份键：用「去色码显示名 + 物品id」唯一标识（RPG 服同一 id 常有多种自定义名物品，必须按显示名区分）
function itemKey(it: { display?: string | null; name?: string | null; texture?: string | null }): string {
  return `${mcPlain(it.display || it.name || "")}\0${it.texture || ""}`;
}
function usageLsKey(botId: string): string {
  return `mcbot.itemUsage.${botId}`;
}
function loadUsage(botId: string): UsageMap {
  try {
    return JSON.parse(localStorage.getItem(usageLsKey(botId)) || "{}") as UsageMap;
  } catch {
    return {};
  }
}
function saveUsage(botId: string, map: UsageMap): void {
  try {
    localStorage.setItem(usageLsKey(botId), JSON.stringify(map));
  } catch {
    /* localStorage 满/禁用 → 忽略，不影响功能 */
  }
}

export default function InventoryTab({ bot }: { bot: BotSummary }) {
  // 键优先 bot.id；回退 username 兼容无 _bid 的旧引擎（与 engine.ts 存储键、store.removeBot 双键清理一致）
  const items = useStore((s) => s.inventory[bot.id] ?? s.inventory[bot.username]) ?? EMPTY_ITEMS;
  const invMode = useStore((s) => s.invMode);
  const setInvMode = useStore((s) => s.setInvMode);
  const connUrl = useStore((s) => s.conn.url);
  const pushToast = useStore((s) => s.pushToast);
  const full = invMode === "full";
  const [syncing, setSyncing] = useState(false);
  const texBase = `${connUrl.replace(/\/+$/, "")}/textures/${bot.version || "1.12.2"}`;

  // 使用频率记账（useCallback：引用稳定才不击穿 ItemRow 的 memo）
  const [usage, setUsage] = useState<UsageMap>(() => loadUsage(bot.id));
  useEffect(() => setUsage(loadUsage(bot.id)), [bot.id]);
  const recordUse = useCallback(
    (item: InventoryItem, action: UseAction) => {
      setUsage((prev) => {
        const k = itemKey(item);
        const prevE = prev[k];
        const next: UsageMap = {
          ...prev,
          [k]: {
            key: k,
            display: item.display || item.name || "",
            texture: item.texture,
            count: (prevE?.count || 0) + 1,
            lastUsed: Date.now(),
            lastAction: action,
          },
        };
        saveUsage(bot.id, next);
        return next;
      });
    },
    [bot.id],
  );
  function forgetUse(key: string) {
    setUsage((prev) => {
      const next = { ...prev };
      delete next[key];
      saveUsage(bot.id, next);
      return next;
    });
  }

  useEffect(() => {
    if (bot.online) cmd.moduleAction(bot.id, "inventory", "sync");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.id, bot.online]);

  const { groups, count, used } = useMemo(() => {
    const g: Record<Cat, InventoryItem[]> = { equip: [], hotbar: [], main: [] };
    let c = 0;
    for (const it of items) {
      if (!it.name) continue;
      const cat = categorize(it.slot);
      if (!cat) continue;
      g[cat].push(it);
      c++;
    }
    return { groups: g, count: c, used: g.hotbar.length + g.main.length };
  }, [items]);

  // 常用列表：按频率(→最近)排序取前 8；与当前背包匹配，标记是否在包(live)
  const frequent = useMemo(() => {
    const liveByKey = new Map<string, InventoryItem>();
    for (const it of items) if (it.name) liveByKey.set(itemKey(it), it);
    return Object.values(usage)
      .sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed)
      .slice(0, 8)
      .map((e) => ({ entry: e, live: liveByKey.get(e.key) || null }));
  }, [usage, items]);

  // 潜行使用开关（全局习惯，localStorage 持久）：开启后「使用」在 sneak 状态下右键——
  // 适配只在潜行+右键触发的自定义物品，并避免误触脚下/面前方块。
  const [sneakUse, setSneakUse] = useState(() => {
    try {
      return localStorage.getItem("mcbot.inv.sneak") === "1";
    } catch {
      return false;
    }
  });
  // 稳定引用：传进 memo(ItemRow) 不击穿其 memo；act 读 .current 总拿最新值
  const sneakRef = useRef(sneakUse);
  sneakRef.current = sneakUse;
  const toggleSneak = () => {
    setSneakUse((v) => {
      const next = !v;
      try {
        localStorage.setItem("mcbot.inv.sneak", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  async function quickUse(live: InventoryItem, action: UseAction) {
    const extra = action === "use" && sneakRef.current ? { sneak: true } : {};
    const r = await cmd.moduleAction(bot.id, "inventory", action, { slot: live.slot, ...extra });
    if (!r.ok) pushToast(r.error || "操作失败", "error");
    else recordUse(live, action);
  }

  // 「整理背包」：常驻 MC 布局界面——点选源格→点目标格连续搬运，悬浮看完整物品信息
  const [organize, setOrganize] = useState<{ open: boolean; initialSel?: number }>({ open: false });
  // 书本阅读器：成书只读翻页，书与笔可编辑回写
  const [bookSlot, setBookSlot] = useState<number | null>(null);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs text-muted">
          背包 {used}/36
          {groups.equip.length > 0 && <span className="ml-1.5">· 装备 {groups.equip.length}</span>}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleSneak}
            title="开启后「使用」物品时潜行右键（适配只在潜行触发的自定义物品，避免误触脚下/面前方块）"
            className={cn(
              "flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] transition-colors",
              sneakUse
                ? "border-accent/40 bg-accent/15 text-accent"
                : "border-border text-muted hover:text-fg",
            )}
          >
            <ArrowDownToLine className="h-3.5 w-3.5" /> 潜行使用
          </button>
          <Button size="sm" variant="secondary" disabled={!bot.online} onClick={() => setOrganize({ open: true })}>
            <LayoutGrid className="h-3.5 w-3.5" /> 整理背包
          </Button>
          <div className="flex shrink-0 overflow-hidden rounded-lg border border-border text-[11px]">
            {(["lite", "full"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setInvMode(m)}
                className={cn(
                  "px-2 py-1 transition-colors",
                  invMode === m ? "bg-accent/15 text-accent" : "text-muted hover:text-fg",
                )}
              >
                {m === "lite" ? "精简" : "完全"}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={!bot.online || syncing}
            onClick={async () => {
              setSyncing(true);
              const r = await cmd.moduleAction(bot.id, "inventory", "sync");
              setSyncing(false);
              pushToast(r.ok ? "背包已刷新" : (r.error || "刷新失败"), r.ok ? "success" : "error");
            }}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} /> 刷新
          </Button>
        </div>
      </div>

      {!bot.online ? (
        <Empty text="机器人离线" />
      ) : (
        <div className="space-y-4">
          {/* 常用栏（自创，置顶，不影响原版槽位）：上次用过的道具按频率排，方便接着用 */}
          {frequent.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted">
                <Star className="h-3.5 w-3.5 text-accent" /> 常用
                <span className="font-normal text-muted/60">按使用频率 · 点一下接着用</span>
              </div>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {frequent.map(({ entry, live }) => (
                  <FreqRow
                    key={entry.key}
                    entry={entry}
                    live={live}
                    online={!!bot.online}
                    texBase={texBase}
                    onUse={() => live && quickUse(live, entry.lastAction)}
                    onForget={() => forgetUse(entry.key)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 主手：当前手持（选中的快捷栏格），单独置于快捷栏前，一眼看清拿的是什么 */}
          {(() => {
            const held = items.find((it) => it.held && it.name);
            return (
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted">
                  <Hand className="h-3.5 w-3.5 text-accent" /> 主手
                  <span className="font-normal text-muted/60">当前手持</span>
                </div>
                {held ? (
                  <div className="flex items-center gap-2.5 rounded-lg border border-accent/40 bg-accent/8 px-3 py-2">
                    <ItemIcon texture={held.texture} base={texBase} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        <McText text={held.display || held.name || ""} />
                      </div>
                      {held.enchants && held.enchants.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {held.enchants.map((e, i) => (
                            <span key={i} className="rounded bg-accent/12 px-1.5 py-px text-[10px] text-accent">
                              {e}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {held.count && held.count > 1 && (
                      <span className="shrink-0 text-[11px] text-muted">×{held.count}</span>
                    )}
                    <span className="shrink-0 text-[10px] text-muted/50 tabular-nums">#{held.slot}</span>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border/60 bg-surface-2/30 px-3 py-2 text-sm text-muted">
                    空手
                  </div>
                )}
              </div>
            );
          })()}

          {count === 0 ? (
            <Empty text="背包为空，或点击刷新同步" />
          ) : (
            CAT_ORDER.map((cat) =>
              groups[cat].length === 0 ? null : (
                <div key={cat}>
                  <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-muted">
                    {CAT_LABEL[cat]}
                    <span className="rounded bg-surface-2 px-1.5 py-px">{groups[cat].length}</span>
                  </div>
                  <div className="space-y-1">
                    {groups[cat].map((it) => (
                      <ItemRow
                        key={it.slot}
                        item={it}
                        botId={bot.id}
                        online={!!bot.online}
                        full={full}
                        texBase={texBase}
                        onUse={recordUse}
                        onReadBook={setBookSlot}
                        sneakRef={sneakRef}
                      />
                    ))}
                  </div>
                </div>
              ),
            )
          )}
        </div>
      )}

      {/* 整理背包：常驻 MC 布局界面，可连续搬运/交换，悬浮看完整物品信息 */}
      {organize.open && (
        <OrganizeDialog
          botId={bot.id}
          items={items}
          texBase={texBase}
          initialSel={organize.initialSel}
          onClose={() => setOrganize({ open: false })}
        />
      )}

      {/* 书本阅读器 */}
      {bookSlot !== null && <BookDialog botId={bot.id} slot={bookSlot} onClose={() => setBookSlot(null)} />}
    </div>
  );
}

/** 书本阅读器：成书（只读翻页）/ 书与笔（逐页编辑 + 加页 + 保存回写） */
function BookDialog({ botId, slot, onClose }: { botId: string; slot: number; onClose: () => void }) {
  const pushToast = useStore((s) => s.pushToast);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ writable: boolean; title: string | null; author: string | null }>({ writable: false, title: null, author: null });
  const [pages, setPages] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await cmd.moduleAction(botId, "inventory", "readBook", { slot });
      if (!alive) return;
      setLoading(false);
      if (r.ok && r.data) {
        const d = r.data as { writable: boolean; title: string | null; author: string | null; pages: string[] };
        setMeta({ writable: d.writable, title: d.title, author: d.author });
        setPages(d.pages.length ? d.pages : [""]);
      } else {
        setErr(r.error || "读取失败");
      }
    })();
    return () => {
      alive = false;
    };
  }, [botId, slot]);

  async function save() {
    setSaving(true);
    const r = await cmd.moduleAction(botId, "inventory", "writeBook", { slot, pages });
    setSaving(false);
    if (r.ok) {
      setDirty(false);
      pushToast("已写入书与笔", "success");
    } else {
      pushToast(r.error || "写入失败", "error");
    }
  }

  const total = pages.length;
  return (
    <Modal
      open
      onClose={onClose}
      title={meta.title ? `《${meta.title}》${meta.author ? ` · ${meta.author}` : ""}` : meta.writable ? "书与笔" : "书"}
      size="lg"
      footer={
        <>
          {meta.writable && (
            <>
              <Button variant="ghost" onClick={() => { setPages((p) => [...p, ""]); setIdx(total); setDirty(true); }}>
                <Plus className="h-3.5 w-3.5" /> 加一页
              </Button>
              <Button variant="primary" disabled={!dirty || saving} onClick={save}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} 保存到书
              </Button>
            </>
          )}
          <Button variant="secondary" onClick={onClose}>关闭</Button>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> 读取中…
        </div>
      ) : err ? (
        <div className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>
      ) : (
        <div className="space-y-2.5">
          {/* 仿羊皮纸页面 */}
          {meta.writable ? (
            <textarea
              value={pages[idx] ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setPages((p) => p.map((x, i) => (i === idx ? v : x)));
                setDirty(true);
              }}
              rows={12}
              className="w-full resize-y rounded-lg border border-[#cbb78a] bg-[#f5ecd7] px-4 py-3 font-serif text-sm leading-relaxed text-[#3b2f1d] outline-none focus:border-[#a98f57]"
              placeholder="（这一页还是空的）"
            />
          ) : (
            <div className="min-h-[16rem] whitespace-pre-wrap rounded-lg border border-[#cbb78a] bg-[#f5ecd7] px-4 py-3 font-serif text-sm leading-relaxed text-[#3b2f1d]">
              {pages[idx] || <span className="text-[#3b2f1d]/40">（空白页）</span>}
            </div>
          )}
          <div className="flex items-center justify-between">
            <button
              disabled={idx <= 0}
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted enabled:hover:bg-surface-2 enabled:hover:text-fg disabled:opacity-30"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> 上一页
            </button>
            <span className="text-xs tabular-nums text-muted">第 {idx + 1} / {total} 页</span>
            <button
              disabled={idx >= total - 1}
              onClick={() => setIdx((i) => Math.min(total - 1, i + 1))}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted enabled:hover:bg-surface-2 enabled:hover:text-fg disabled:opacity-30"
            >
              下一页 <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

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

/**
 * 整理背包：常驻 MC 布局界面。
 * - 点一件物品=选中（高亮），再点目标格=移动/交换，界面不关，可一直整理；
 * - 悬浮任意物品显示完整 ItemTip（名字/数量/附魔/lore/物品 id）；
 * - 数据来自 store 实时背包，每次移动后引擎广播自动刷新格子。
 */
function OrganizeDialog({
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
    let left = r.left + r.width / 2 - w / 2;
    left = Math.min(Math.max(m, left), window.innerWidth - w - m);
    let top = r.top - h - 8; // 优先格子上方（不挡手）
    if (top < m) top = Math.min(r.bottom + 8, window.innerHeight - h - m); // 放不下 → 下方
    if (top < m) top = m;
    setTipStyle({ left, top, maxHeight: window.innerHeight - top - m });
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

  const Cell = ({ slot, label }: { slot: number; label?: string }) => (
    <OrgCell
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
            <Cell slot={5} label="头" />
            <Cell slot={6} label="胸" />
            <Cell slot={7} label="腿" />
            <Cell slot={8} label="脚" />
            <span className="mx-1 self-center text-muted/30">|</span>
            <Cell slot={45} label="副手" />
          </div>
        </div>
        <div>
          <div className="mb-1 text-[11px] font-medium text-muted">背包</div>
          <div className="grid w-fit grid-cols-9 gap-1">
            {Array.from({ length: 27 }, (_, i) => (
              <Cell key={9 + i} slot={9 + i} />
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[11px] font-medium text-muted">快捷栏（高亮圈=当前手持）</div>
          <div className="grid w-fit grid-cols-9 gap-1">
            {Array.from({ length: 9 }, (_, i) => (
              <Cell key={36 + i} slot={36 + i} />
            ))}
          </div>
        </div>
      </div>

      {/* ItemTip：完整物品信息（优先光标上方，超长限高滚动；测量定位见上方 useLayoutEffect） */}
      {tip && (
        <div
          ref={tipRef}
          className="pointer-events-none fixed z-[120] max-w-[20rem] overflow-y-auto rounded border border-[#34106b] bg-[#100016]/95 px-2.5 py-2 shadow-xl"
          style={tipStyle}
        >
          <div className="text-sm font-semibold leading-snug">
            <McText text={tip.it.display || tip.it.name || ""} onDark />
            {tip.it.count && tip.it.count > 1 ? (
              <span className="ml-1 text-[11px] font-normal text-white/50">×{tip.it.count}</span>
            ) : null}
          </div>
          {tip.it.enchants && tip.it.enchants.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {tip.it.enchants.map((e, i) => (
                <div key={i} className="text-[11px] text-[#9d8bff]">{e}</div>
              ))}
            </div>
          )}
          {tip.it.lore && (
            <div className="mt-1 whitespace-pre-line text-[11px] leading-snug text-white/75">
              <McText text={tip.it.lore} onDark />
            </div>
          )}
          {tip.it.texture && <div className="mt-1.5 text-[10px] text-white/30">minecraft:{tip.it.texture} · #{tip.it.slot}</div>}
        </div>
      )}
    </Modal>
  );
}

/** 常用栏的一行：在包则可一键重复上次动作；不在包则灰显「缺货」并保留位置（可手动移除） */
function FreqRow({
  entry,
  live,
  online,
  texBase,
  onUse,
  onForget,
}: {
  entry: UsageEntry;
  live: InventoryItem | null;
  online: boolean;
  texBase: string;
  onUse: () => void;
  onForget: () => void;
}) {
  const ActIcon = ACTION_ICON[entry.lastAction];
  const gone = !live;
  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-lg border px-2.5 py-1.5",
        gone ? "border-border/50 bg-surface-2/30 opacity-55" : "border-accent/25 bg-accent/5",
      )}
    >
      <ItemIcon texture={entry.texture} base={texBase} size={26} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          <McText text={entry.display} />
        </div>
        <div className="text-[10px] text-muted">
          用过 {entry.count} 次{live && live.count && live.count > 1 ? ` · 背包 ×${live.count}` : ""}
          {gone && <span className="text-warning"> · 缺货</span>}
        </div>
      </div>
      {online && !gone && (
        <button
          title={`${ACTION_LABEL[entry.lastAction]}（重复上次动作）`}
          onClick={onUse}
          className="flex shrink-0 items-center gap-1 rounded-md bg-accent/15 px-2 py-1 text-xs font-medium text-accent hover:bg-accent/25"
        >
          <ActIcon className="h-3.5 w-3.5" /> {ACTION_LABEL[entry.lastAction]}
        </button>
      )}
      <button
        title="从常用移除"
        onClick={onForget}
        className="shrink-0 rounded p-0.5 text-muted/50 opacity-60 transition-opacity hover:text-fg group-hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// memo：BotPanel 每 2s 收到状态推送会整树重渲，背包未变时 36 行直接跳过
// （item 对象在两次背包同步之间引用稳定；onUse/onReadBook 上游已保证引用稳定）
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
              {item.enchants.map((e, i) => (
                <span key={i} className="rounded bg-accent/12 px-1.5 py-px text-[10px] text-accent">
                  {e}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {tipOpen && (
        <div
          ref={tipRef}
          onMouseEnter={cancelClose}
          onMouseLeave={clearTip}
          className="invisible fixed left-0 top-0 z-[100] max-h-[55vh] max-w-[18rem] overflow-y-auto overscroll-contain rounded border border-[#34106b] bg-[#100016]/95 px-2.5 py-2 shadow-xl"
        >
          <div className="text-sm font-semibold leading-snug">
            <McText text={name} onDark />
            {item.count && item.count > 1 ? (
              <span className="ml-1 text-[11px] font-normal text-white/50">×{item.count}</span>
            ) : null}
          </div>
          {item.enchants && item.enchants.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {item.enchants.map((e, i) => (
                <div key={i} className="text-[11px] text-[#9d8bff]">
                  {e}
                </div>
              ))}
            </div>
          )}
          {item.lore && (
            <div className="mt-1 whitespace-pre-line text-[11px] leading-snug text-white/75">
              <McText text={item.lore} onDark />
            </div>
          )}
          {item.texture && <div className="mt-1.5 text-[10px] text-white/30">minecraft:{item.texture}</div>}
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
    <button title={title} onClick={onClick} className="rounded p-1.5 text-muted transition hover:bg-surface hover:text-fg active:scale-90">
      {children}
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center py-10 text-muted">
      <Package className="mb-2 h-8 w-8 opacity-40" />
      <p className="text-sm">{text}</p>
    </div>
  );
}
