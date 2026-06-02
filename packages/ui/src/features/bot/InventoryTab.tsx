import { useEffect } from "react";
import { RefreshCw, Package } from "lucide-react";
import { useStore } from "@/store/useStore";
import { cmd } from "@/lib/engine";
import { Button } from "@/components/ui/primitives";
import type { BotSummary, InventoryItem } from "@mcbot/protocol";

// 模块级稳定空数组：避免 zustand v5 选择器返回新引用导致无限重渲染
const EMPTY_ITEMS: InventoryItem[] = [];

export default function InventoryTab({ bot }: { bot: BotSummary }) {
  const items = useStore((s) => s.inventory[bot.username]) ?? EMPTY_ITEMS;

  useEffect(() => {
    if (bot.online) cmd.moduleAction(bot.id, "inventory", "sync");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.id, bot.online]);

  const filled = items.filter((it) => it.name);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-muted">已占用 {filled.length} 格</span>
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
      ) : filled.length === 0 ? (
        <Empty text="背包为空，或点击刷新同步" />
      ) : (
        <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-9">
          {filled.map((it) => (
            <div
              key={it.slot}
              title={`${it.name}${it.lore ? "\n" + it.lore : ""}`}
              className="relative flex aspect-square items-center justify-center rounded-md border border-border bg-surface-2 p-1 text-center"
            >
              <span className="break-all text-[9px] leading-tight text-muted line-clamp-2">
                {it.texture || it.name}
              </span>
              {it.count && it.count > 1 && (
                <span className="absolute bottom-0 right-0.5 text-[10px] font-bold text-fg">{it.count}</span>
              )}
            </div>
          ))}
        </div>
      )}
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
