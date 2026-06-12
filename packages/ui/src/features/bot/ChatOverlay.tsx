import { useEffect, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { cn } from "@/lib/cn";
import McText from "@/components/McText";
import { mcPlain } from "@/lib/format";

/**
 * 悬浮字幕：把最近的聊天/actionbar/错误日志浮在交互画面上（实时视角、服务器菜单窗口），
 * 几秒后淡出——点菜单/发指令时不用切去控制台就能看到服务器的反馈，和游戏内聊天框一个体感。
 *
 * 实现要点：
 * - 只播「挂载之后新到」的行（挂载时把游标推到最新 seq），不回放历史；
 * - LogLine.time 是格式化字符串，没有毫秒戳——到达时间由本组件用 Date.now() 记账；
 * - pointer-events-none：纯展示层，绝不挡画面/菜单的点击。
 */

const SHOW_MS = 8000; // 每条停留时长
const FADE_MS = 1500; // 结尾淡出窗口
const MAX_LINES = 6;

interface FloatLine {
  seq: number;
  text: string;
  level: string;
  bornAt: number;
}

export default function ChatOverlay({ botId, className }: { botId: string; className?: string }) {
  const logs = useStore((s) => s.logs[botId]);
  const [lines, setLines] = useState<FloatLine[]>([]);
  const [now, setNow] = useState(() => Date.now());
  // 挂载时跳过既有历史：游标起点 = 当前最新 seq
  const cursorRef = useRef<number | null>(null);

  useEffect(() => {
    const list = logs ?? [];
    if (cursorRef.current === null) {
      cursorRef.current = list.length ? (list[list.length - 1].seq ?? 0) : 0;
      return;
    }
    const fresh: FloatLine[] = [];
    const t = Date.now();
    for (let i = list.length - 1; i >= 0; i--) {
      const l = list[i];
      const seq = l.seq ?? 0;
      if (seq <= cursorRef.current) break;
      const level = l.level ?? "info";
      // 聊天/actionbar 是「点菜单的效果」主体；error 是出错反馈。info 噪声大（模块日志），不上字幕。
      if (level === "chat" || level === "actionbar" || level === "error") {
        fresh.push({ seq, text: l.text, level, bornAt: t });
      }
    }
    if (list.length) cursorRef.current = list[list.length - 1].seq ?? cursorRef.current;
    if (fresh.length) {
      fresh.reverse();
      setLines((prev) => [...prev, ...fresh].slice(-MAX_LINES));
    }
  }, [logs]);

  // 有字幕在场时才走 500ms 心跳做老化/淡出，空场零开销
  useEffect(() => {
    if (!lines.length) return;
    const t = setInterval(() => {
      const cur = Date.now();
      setNow(cur);
      setLines((prev) => {
        const kept = prev.filter((l) => cur - l.bornAt < SHOW_MS);
        return kept.length === prev.length ? prev : kept;
      });
    }, 500);
    return () => clearInterval(t);
  }, [lines.length]);

  if (!lines.length) return null;
  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-2 left-2 z-[16] flex max-w-[85%] flex-col items-start gap-0.5",
        className,
      )}
    >
      {lines.map((l) => {
        const age = now - l.bornAt;
        const opacity = age > SHOW_MS - FADE_MS ? Math.max(0, (SHOW_MS - age) / FADE_MS) : 1;
        return (
          <div
            key={l.seq}
            style={{ opacity, transition: "opacity 0.4s linear" }}
            className={cn(
              "max-w-full truncate rounded bg-black/55 px-2 py-0.5 text-[12px] leading-5 text-white shadow",
              l.level === "actionbar" && "text-amber-200",
              l.level === "error" && "text-rose-300",
            )}
            title={mcPlain(l.text)}
          >
            {/* 服务器消息常带 §色码：McText 渲染成彩色（字幕始终深底，onDark 提亮过暗色） */}
            <McText text={l.text} onDark />
          </div>
        );
      })}
    </div>
  );
}
