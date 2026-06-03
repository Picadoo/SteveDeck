import { useEffect, useRef, useState } from "react";
import { Trash2, Copy, ArrowDownToLine } from "lucide-react";
import { useStore } from "@/store/useStore";
import { cn } from "@/lib/cn";
import McText from "@/components/McText";
import type { LogLine } from "@mcbot/protocol";

// 模块级稳定空数组：避免 zustand v5 选择器返回新引用导致无限重渲染
const EMPTY_LOGS: LogLine[] = [];

export default function Console({ botId }: { botId: string }) {
  const logs = useStore((s) => s.logs[botId]) ?? EMPTY_LOGS;
  const clearLog = useStore((s) => s.clearLog);
  const pushToast = useStore((s) => s.pushToast);
  const [filter, setFilter] = useState("");
  const [level, setLevel] = useState<"all" | "chat" | "op">("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  const shown = logs.filter((l) => {
    if (level === "chat" && l.level !== "chat") return false;
    if (level === "op" && l.level === "chat") return false;
    if (filter && !l.text.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  useEffect(() => {
    if (!autoScroll) return;
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown, autoScroll]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(logs.map((l) => `${l.time} ${l.text}`).join("\n"));
      pushToast("日志已复制", "success");
    } catch {
      pushToast("复制失败", "error");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex shrink-0 items-center gap-2">
        <div className="flex shrink-0 overflow-hidden rounded-lg border border-border text-[11px]">
          {(["all", "chat", "op"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setLevel(v)}
              className={cn(
                "px-2 py-1 transition-colors",
                level === v ? "bg-accent/15 text-accent" : "text-muted hover:text-fg",
              )}
            >
              {v === "all" ? "全部" : v === "chat" ? "消息" : "操作"}
            </button>
          ))}
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="过滤日志…"
          className="h-7 flex-1 rounded-lg border border-border bg-surface px-2 text-xs outline-none focus:ring-2 focus:ring-accent/50"
        />
        <ToolBtn active={autoScroll} title="自动滚动" onClick={() => setAutoScroll((a) => !a)}>
          <ArrowDownToLine className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn title="复制全部" onClick={copy}>
          <Copy className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn title="清空" onClick={() => clearLog(botId)}>
          <Trash2 className="h-3.5 w-3.5" />
        </ToolBtn>
      </div>
      {/* 固定深色「终端」底：MC 颜色码本就是为深色背景设计，浅色主题下白/灰字才不会看不清 */}
      <div
        ref={ref}
        className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-zinc-700 bg-[#0a0a0c] p-3 font-mono text-xs leading-relaxed text-zinc-200"
      >
        {shown.length === 0 ? (
          <div className="flex h-full items-center justify-center text-zinc-500">
            {filter ? "无匹配日志" : "暂无日志"}
          </div>
        ) : (
          shown.map((l, i) => (
            <div
              key={i}
              className={cn(
                "whitespace-pre-wrap break-words",
                l.level === "error" && "text-red-400",
                l.level === "warn" && "text-amber-400",
              )}
            >
              <span className="mr-2 select-none text-zinc-500">{l.time}</span>
              <McText text={l.text} onDark />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ToolBtn({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "rounded-md p-1.5 transition-colors",
        active ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-2 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
