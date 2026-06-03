import { useEffect, useMemo } from "react";
import { RefreshCw, Package } from "lucide-react";
import { useStore } from "@/store/useStore";
import { cmd } from "@/lib/engine";
import { Button } from "@/components/ui/primitives";
import type { BotSummary, InventoryItem } from "@mcbot/protocol";

// 模块级稳定空数组：避免 zustand v5 选择器返回新引用导致无限重渲染
const EMPTY_ITEMS: InventoryItem[] = [];

type Cat = "equip" | "hotbar" | "main";
const CAT_LABEL: Record<Cat, string> = { equip: "装备", hotbar: "快捷栏", main: "背包" };
const CAT_ORDER: Cat[] = ["equip", "hotbar", "main"];

function categorize(slot: number): Cat | null {
  if ((slot >= 5 && slot <= 8) || slot === 45) return "equip";
  if (slot >= 36 && slot <= 44) return "hotbar";
  if (slot >= 9 && slot <= 35) return "main";
  return null; // 合成格等忽略
}

export default function InventoryTab({ bot }: { bot: BotSummary }) {
  const items = useStore((s) => s.inventory[bot.username]) ?? EMPTY_ITEMS;

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
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-muted">已占用 {count} 格</span>
        <Button
          size="sm"
          variant="secondary"
          disabled={!bot.online}
          onClick={() => cmd.moduleAction(bot.id, "inventory", "sync")}
        >
          <RefreshCw className="h-3.5 w-3.5" /> 刷新
        </Button>
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
                    <ItemRow key={it.slot} item={it} />
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

function ItemRow({ item }: { item: InventoryItem }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-surface-2/50 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{item.name}</span>
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
        {item.lore && (
          <p className="mt-1 whitespace-pre-line text-[11px] leading-snug text-muted line-clamp-4">
            {item.lore}
          </p>
        )}
      </div>
      <span className="shrink-0 pt-0.5 text-[10px] text-muted/50 tabular-nums">#{item.slot}</span>
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
