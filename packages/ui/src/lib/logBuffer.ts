// 日志入库的纯逻辑（从 useStore.appendLog 抽出，便于单测）：UI 最热路径——挂机刷屏时每条日志都过这里。
import { mcPlain } from "./format";
import type { LogLine } from "@mcbot/protocol";

export const MAX_LOG_LINES = 500;

// 渲染序号：单调递增，给 React 当稳定 key。满 500 条后是滑动窗口，
// 基于内容/下标的 key 会整窗左移 → 500 行 unmount+remount（低端机 30-80ms/条）。
let logSeq = 0;

/**
 * 入库一条日志：赋单调 seq、缓存洗色 plain（过滤框每键入一个字符要扫全部行，
 * 现场重洗是 500 行 × 每键一次的正则开销）、满窗滑动左移丢最旧一条。
 * 返回新数组（不改 prev，zustand 引用比较友好）。
 */
export function pushLogLine(prev: LogLine[], line: LogLine, max = MAX_LOG_LINES): LogLine[] {
  line.seq = ++logSeq;
  line.plain = mcPlain(line.text);
  return prev.length >= max ? [...prev.slice(prev.length - max + 1), line] : [...prev, line];
}
