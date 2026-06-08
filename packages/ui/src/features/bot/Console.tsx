import { useEffect, useRef, useState } from "react";
import { Trash2, Copy, ArrowDownToLine } from "lucide-react";
import { useStore } from "@/store/useStore";
import { cmd } from "@/lib/engine";
import { cn } from "@/lib/cn";
import McText from "@/components/McText";
import MonitorPanel from "./MonitorPanel";
import { mcPlain } from "@/lib/format";
import type { LogLine, ChatSegment } from "@mcbot/protocol";

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

  // 过滤规则：去 §/& 色码后按纯文本匹配（=屏幕上看到的字）。
  // 空格分词=「且」(全部命中)；以 - 开头的词=「排除」。例：输入 `-金币猪` 滤掉刷怪刷屏，`暴击 -金币猪` 看非刷怪的暴击。
  const needle = filter.trim().toLowerCase();
  const terms = needle.split(/\s+/).filter(Boolean);
  const incl = terms.filter((t) => !t.startsWith("-"));
  const excl = terms.filter((t) => t.startsWith("-") && t.length > 1).map((t) => t.slice(1));
  // actionbar 与聊天同归「消息」类（一起显示），「操作」里排除它俩
  const isMsg = (lv?: string) => lv === "chat" || lv === "actionbar";
  const byLevel = logs.filter(
    (l) => !(level === "chat" && !isMsg(l.level)) && !(level === "op" && isMsg(l.level)),
  );
  const shown = byLevel.filter((l) => {
    if (!terms.length) return true;
    const t = mcPlain(l.text).toLowerCase();
    return incl.every((w) => t.includes(w)) && !excl.some((w) => t.includes(w));
  });

  useEffect(() => {
    if (!autoScroll) return;
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown, autoScroll]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(logs.map((l) => `${l.time ?? ""} ${mcPlain(l.text)}`).join("\n"));
      pushToast("日志已复制", "success");
    } catch {
      pushToast("复制失败", "error");
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* 监听统计：紧凑面板，齿轮进配置弹窗（并入日志页，不再单独成栏） */}
      <MonitorPanel botId={botId} />
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
        <div className="relative flex-1">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="过滤…  空格=且, -词=排除（如 -金币猪）"
            className="h-7 w-full rounded-lg border border-border bg-surface px-2 pr-14 text-xs outline-none focus:ring-2 focus:ring-accent/50"
          />
          {terms.length > 0 && (
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted">
              {shown.length}/{byLevel.length}
            </span>
          )}
        </div>
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
      <div
        ref={ref}
        className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-surface-2/40 p-3 font-mono text-xs leading-relaxed"
      >
        {shown.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted">
            {filter ? "无匹配日志" : "暂无日志"}
          </div>
        ) : (
          shown.map((l, i) => (
            <div
              key={i}
              className={cn(
                "whitespace-pre-wrap break-words",
                l.level === "error" && "text-danger",
                l.level === "warn" && "text-warning",
              )}
            >
              <span className="mr-2 select-none text-muted">{l.time}</span>
              {l.level === "actionbar" && (
                <span className="mr-1 rounded bg-accent/15 px-1 text-[10px] text-accent">栏</span>
              )}
              {l.segments && l.segments.length ? (
                <SegmentLine segments={l.segments} botId={botId} />
              ) : (
                <McText text={l.text} />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// MC 颜色名 → CSS（JSON 聊天的 color 是 "red"/"gold" 或 "#RRGGBB"）
const MC_COLOR: Record<string, string> = {
  black: "#000000", dark_blue: "#5555FF", dark_green: "#00AA00", dark_aqua: "#00AAAA",
  dark_red: "#FF5555", dark_purple: "#AA00AA", gold: "#FFAA00", gray: "#AAAAAA",
  dark_gray: "#888888", blue: "#5555FF", green: "#55FF55", aqua: "#55FFFF",
  red: "#FF5555", light_purple: "#FF55FF", yellow: "#FFFF55", white: "#FFFFFF",
};
const colorOf = (c?: string) => (!c ? undefined : c.startsWith("#") ? c : MC_COLOR[c]);

/** 渲染可点击/可悬浮聊天：clickEvent → 点击执行命令/开链接/复制；hoverEvent → 悬浮提示。 */
function SegmentLine({ segments, botId }: { segments: ChatSegment[]; botId: string }) {
  const pushToast = useStore((s) => s.pushToast);
  async function fire(seg: ChatSegment) {
    const c = seg.click;
    if (!c) return;
    if (c.action === "run_command") {
      const r = await cmd.chat(botId, c.value);
      pushToast(r.ok ? `已执行：${c.value}` : r.error || "执行失败", r.ok ? "success" : "error");
    } else if (c.action === "suggest_command") {
      try {
        await navigator.clipboard.writeText(c.value);
        pushToast(`已复制命令：${c.value}（粘贴到聊天框发送）`, "info");
      } catch {
        pushToast(c.value, "info");
      }
    } else if (c.action === "open_url") {
      try {
        window.open(c.value, "_blank", "noopener");
      } catch {
        /* ignore */
      }
    } else if (c.action === "copy_to_clipboard") {
      try {
        await navigator.clipboard.writeText(c.value);
        pushToast("已复制", "success");
      } catch {
        /* ignore */
      }
    }
  }
  return (
    <>
      {segments.map((s, i) => {
        // 片段文字里可能内嵌 §/& 旧版颜色码（部分服务器把色码塞进 JSON 组件的 text）：
        // 交给 McText 渲染成颜色，避免「§e§4」原样显示。自带颜色（JSON color 或 §码）时不强加 accent。
        const hasOwnColor = !!s.color || /[§&]/.test(s.text);
        const baseStyle: React.CSSProperties = {
          color: hasOwnColor ? colorOf(s.color) : undefined,
          fontWeight: s.bold ? 700 : undefined,
          fontStyle: s.italic ? "italic" : undefined,
          textDecoration:
            [s.underlined && "underline", s.strikethrough && "line-through"].filter(Boolean).join(" ") || undefined,
        };
        const body = <McText text={s.text} />;
        if (s.click) {
          return (
            <button
              key={i}
              type="button"
              onClick={() => fire(s)}
              title={s.hover || `点击：${s.click.value}`}
              className={cn(
                "cursor-pointer rounded px-0.5 font-medium underline decoration-dotted underline-offset-2 hover:bg-accent/15",
                !hasOwnColor && "text-accent",
              )}
              style={{ color: baseStyle.color, fontWeight: baseStyle.fontWeight, fontStyle: baseStyle.fontStyle }}
            >
              {body}
            </button>
          );
        }
        return (
          <span
            key={i}
            title={s.hover || undefined}
            className={s.hover ? "cursor-help underline decoration-dotted decoration-muted underline-offset-2" : undefined}
            style={baseStyle}
          >
            {body}
          </span>
        );
      })}
    </>
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
