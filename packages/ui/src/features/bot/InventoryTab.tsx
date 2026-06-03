import { useEffect, useMemo, useState, type ReactNode } from "react";
import { RefreshCw, Package, Shirt, Hand, Trash2, MousePointerClick } from "lucide-react";
import { useStore } from "@/store/useStore";
import { cmd } from "@/lib/engine";
import { Button } from "@/components/ui/primitives";
import McText from "@/components/McText";
import { cn } from "@/lib/cn";
import type { BotSummary, InventoryItem } from "@mcbot/protocol";

// 模块级稳定空数组：避免 zustand v5 选择器返回新引用导致无限重渲染
const EMPTY_ITEMS: InventoryItem[] = [];

type Cat = "equip" | "hotbar" | "main";
const CAT_LABEL: Record<Cat, string> = { equip: "装备", hotbar: "快捷栏", main: "背包" };
const CAT_ORDER: Cat[] = ["equip", "hotbar", "main"];

// 物品 id → 贴图文件名的常见别名（1.12.2 旧命名与 id 不一致处）
const TEX_ALIAS: Record<string, string> = {
  golden_apple: "apple_golden",
  golden_carrot: "carrot_golden",
  cooked_beef: "beef_cooked",
  cooked_porkchop: "porkchop_cooked",
  cooked_chicken: "chicken_cooked",
  cooked_mutton: "mutton_cooked",
  cooked_rabbit: "rabbit_cooked",
  cooked_fish: "fish_cod_cooked",
  cooked_salmon: "fish_salmon_cooked",
  redstone: "redstone_dust",
  snowball: "snowball",
  bow: "bow_standby",
};

function categorize(slot: number): Cat | null {
  if ((slot >= 5 && slot <= 8) || slot === 45) return "equip";
  if (slot >= 36 && slot <= 44) return "hotbar";
  if (slot >= 9 && slot <= 35) return "main";
  return null; // 合成格等忽略
}

const isArmor = (texture?: string) => /(_helmet|_chestplate|_leggings|_boots)$|^elytra$/.test(texture || "");

export default function InventoryTab({ bot }: { bot: BotSummary }) {
  const items = useStore((s) => s.inventory[bot.username]) ?? EMPTY_ITEMS;
  const invMode = useStore((s) => s.invMode);
  const setInvMode = useStore((s) => s.setInvMode);
  const connUrl = useStore((s) => s.conn.url);
  const full = invMode === "full";
  const texBase = `${connUrl.replace(/\/+$/, "")}/textures/${bot.version || "1.12.2"}`;

  useEffect(() => {
    if (bot.online) cmd.moduleAction(bot.id, "inventory", "sync");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.id, bot.online]);

  const { groups, count } = useMemo(() => {
    const g: Record<Cat, InventoryItem[]> = { equip: [], hotbar: [], main: [] };
    let c = 0;
    for (const it of items) {
      if (!it.name) continue;
      const cat = categorize(it.slot);
      if (!cat) continue;
      g[cat].push(it);
      c++;
    }
    return { groups: g, count: c };
  }, [items]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs text-muted">已占用 {count} 格</span>
        <div className="flex items-center gap-2">
          {/* 精简 / 完全 快速切换（与设置同步） */}
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
            disabled={!bot.online}
            onClick={() => cmd.moduleAction(bot.id, "inventory", "sync")}
          >
            <RefreshCw className="h-3.5 w-3.5" /> 刷新
          </Button>
        </div>
      </div>

      {!bot.online ? (
        <Empty text="机器人离线" />
      ) : count === 0 ? (
        <Empty text="背包为空，或点击刷新同步" />
      ) : (
        <div className="space-y-4">
          {CAT_ORDER.map((cat) =>
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
                    />
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** 物品贴图：依次尝试 items/<id> → blocks/<id> → 别名，全失败回退到图标 */
function ItemIcon({ texture, base, size }: { texture?: string; base: string; size: number }) {
  const [stage, setStage] = useState(0);
  useEffect(() => setStage(0), [texture]);

  const id = (texture || "").toLowerCase();
  const alias = TEX_ALIAS[id];
  const candidates = [
    `${base}/items/${id}.png`,
    `${base}/blocks/${id}.png`,
    alias ? `${base}/items/${alias}.png` : null,
    alias ? `${base}/blocks/${alias}.png` : null,
  ].filter(Boolean) as string[];

  const box = { width: size, height: size };
  if (!id || stage >= candidates.length) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded bg-surface-2 text-muted"
        style={box}
      >
        <Package className="h-4 w-4 opacity-50" />
      </div>
    );
  }
  return (
    <img
      src={candidates[stage]}
      alt=""
      draggable={false}
      style={{ ...box, imageRendering: "pixelated" }}
      className="shrink-0 rounded bg-surface-2/60"
      onError={() => setStage((s) => s + 1)}
    />
  );
}

function ItemRow({
  item,
  botId,
  online,
  full,
  texBase,
}: {
  item: InventoryItem;
  botId: string;
  online: boolean;
  full: boolean;
  texBase: string;
}) {
  const pushToast = useStore((s) => s.pushToast);
  const act = async (action: "equip" | "hold" | "use" | "drop") => {
    const r = await cmd.moduleAction(botId, "inventory", action, { slot: item.slot });
    if (!r.ok) pushToast(r.error || "操作失败", "error");
  };
  const armor = isArmor(item.texture);
  const name = item.display || item.name || "";

  return (
    <div className="group flex items-start gap-2.5 rounded-lg bg-surface-2/50 px-3 py-2">
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
        {full && item.lore && (
          <p className="mt-1 whitespace-pre-line text-[11px] leading-snug line-clamp-5">
            <McText text={item.lore} />
          </p>
        )}
      </div>
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
          {!armor && (
            <SlotBtn title="使用（右键）" onClick={() => act("use")}>
              <MousePointerClick className="h-3.5 w-3.5" />
            </SlotBtn>
          )}
          <SlotBtn title="丢弃整组" onClick={() => act("drop")}>
            <Trash2 className="h-3.5 w-3.5 text-danger" />
          </SlotBtn>
        </div>
      )}
      <span className="shrink-0 pt-0.5 text-[10px] text-muted/50 tabular-nums">#{item.slot}</span>
    </div>
  );
}

function SlotBtn({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="rounded p-1 text-muted hover:bg-surface hover:text-fg"
    >
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
