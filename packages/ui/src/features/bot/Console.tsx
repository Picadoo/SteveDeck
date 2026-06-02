import { useEffect, useRef } from "react";
import { useStore } from "@/store/useStore";
import { cn } from "@/lib/cn";
import type { LogLine } from "@mcbot/protocol";

// 模块级稳定空数组：避免 zustand v5 选择器返回新引用导致无限重渲染
const EMPTY_LOGS: LogLine[] = [];

export default function Console({ botId }: { botId: string }) {
  const logs = useStore((s) => s.logs[botId]) ?? EMPTY_LOGS;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <div
      ref={ref}
      className="h-full overflow-y-auto rounded-xl border border-border bg-surface-2/40 p-3 font-mono text-xs leading-relaxed"
    >
      {logs.length === 0 ? (
        <div className="flex h-full items-center justify-center text-muted">暂无日志</div>
      ) : (
        logs.map((l, i) => (
          <div
            key={i}
            className={cn(
              "whitespace-pre-wrap break-words",
              l.level === "error" && "text-danger",
              l.level === "warn" && "text-warning",
            )}
          >
            <span className="mr-2 select-none text-muted">{l.time}</span>
            {l.text}
          </div>
        ))
      )}
    </div>
  );
}
