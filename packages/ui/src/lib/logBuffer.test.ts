/* 日志入库单测：滑动窗口/seq 单调/plain 洗色缓存——挂机刷屏时 UI 最热的路径。 */
import { describe, it, expect } from "vitest";
import { pushLogLine } from "./logBuffer";
import type { LogLine } from "@mcbot/protocol";

const line = (text: string): LogLine => ({ text }) as LogLine;

describe("pushLogLine", () => {
  it("未满时追加，不改原数组", () => {
    const prev: LogLine[] = [];
    const next = pushLogLine(prev, line("a"), 3);
    expect(next.length).toBe(1);
    expect(prev.length).toBe(0);
    expect(next[0].text).toBe("a");
  });

  it("满窗后滑动左移：丢最旧、保持上限", () => {
    let buf: LogLine[] = [];
    for (const t of ["1", "2", "3", "4", "5"]) buf = pushLogLine(buf, line(t), 3);
    expect(buf.map((l) => l.text)).toEqual(["3", "4", "5"]);
  });

  it("seq 单调递增（跨窗口滑动仍不重复），给 React 当稳定 key", () => {
    let buf: LogLine[] = [];
    for (let i = 0; i < 10; i++) buf = pushLogLine(buf, line(String(i)), 3);
    const seqs = buf.map((l) => l.seq!);
    expect(seqs[0] < seqs[1] && seqs[1] < seqs[2]).toBe(true);
    const more = pushLogLine(buf, line("x"), 3);
    expect(more[2].seq!).toBeGreaterThan(seqs[2]);
  });

  it("入库时缓存洗色 plain（过滤热路径不再现场重洗）", () => {
    const l = pushLogLine([], line("§a金币§r +100"), 3)[0];
    expect(l.plain).toBe("金币 +100");
  });
});
