// 背包页主组件。子部件已按职责拆到 inventory/ 目录：
// itemUsage（常用栏记账）/ McItemTip（共享悬浮框）/ ItemRow（物品行）/ OrganizeDialog（整理面板）/ BookDialog（书本阅读器）
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Package, Hand, Star, X, LayoutGrid, ArrowDownToLine } from "lucide-react";
import { useStore } from "@/store/useStore";
import { cmd } from "@/lib/engine";
import { Button } from "@/components/ui/primitives";
import McText from "@/components/McText";
import { ItemIcon } from "@/components/ItemIcon";
import { storage } from "@/lib/safeStorage";
import { cn } from "@/lib/cn";
import { memoBotTab } from "@/lib/memoBotTab";
import ItemRow from "./inventory/ItemRow";
import OrganizeDialog from "./inventory/OrganizeDialog";
import BookDialog from "./inventory/BookDialog";
import {
  ACTION_ICON,
  ACTION_LABEL,
  itemKey,
  loadUsage,
  saveUsage,
  type UsageEntry,
  type UsageMap,
  type UseAction,
} from "./inventory/itemUsage";
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

function InventoryTab({ bot }: { bot: BotSummary }) {
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
  const [sneakUse, setSneakUse] = useState(() => storage.get("mcbot.inv.sneak") === "1");
  // 稳定引用：传进 memo(ItemRow) 不击穿其 memo；act 读 .current 总拿最新值
  const sneakRef = useRef(sneakUse);
  sneakRef.current = sneakUse;
  const toggleSneak = () => {
    setSneakUse((v) => {
      const next = !v;
      storage.set("mcbot.inv.sneak", next ? "1" : "0");
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
          <button type="button"
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
              <button type="button"
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
                          {held.enchants.map((e) => (
                            <span key={e} className="rounded bg-accent/12 px-1.5 py-px text-[10px] text-accent">
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
          用过 {entry.count} 次{live?.count && live.count > 1 ? ` · 背包 ×${live.count}` : ""}
          {gone && <span className="text-warning"> · 缺货</span>}
        </div>
      </div>
      {online && !gone && (
        <button type="button"
          title={`${ACTION_LABEL[entry.lastAction]}（重复上次动作）`}
          onClick={onUse}
          className="flex shrink-0 items-center gap-1 rounded-md bg-accent/15 px-2 py-1 text-xs font-medium text-accent hover:bg-accent/25"
        >
          <ActIcon className="h-3.5 w-3.5" /> {ACTION_LABEL[entry.lastAction]}
        </button>
      )}
      <button type="button"
        title="从常用移除"
        aria-label="从常用移除"
        onClick={onForget}
        className="shrink-0 rounded p-0.5 text-muted/50 opacity-60 transition-opacity hover:text-fg group-hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
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

// 字段白名单 memo：重型 Tab，别跟着 BOT_STATUS 每 2s 全量重跑（背包数据走独立订阅）
export default memoBotTab(InventoryTab, ["id", "online", "username", "version"]);
