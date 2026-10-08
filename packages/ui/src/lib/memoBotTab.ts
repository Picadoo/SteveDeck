import { memo, type ComponentType, type MemoExoticComponent } from "react";
import type { BotSummary } from "@mcbot/protocol";

// BOT_STATUS 每 2s 推一次，upsertBot 必换选中 bot 的对象引用（uptime 恒变，无变化短路是死优化），
// BotPanel 及其当前 Tab 因此每 2s 全量重渲。多数 Tab 只消费 bot 的少数字段——
// 这里按「字段白名单」做 memo：白名单内的字段都没变就跳过整个 Tab 的函数体。
// （与 QuickCommands 手写的比较器同思路，抽成通用工具，避免每个 Tab 各写一份或干脆不写）

/** 字段名，或 [字段名, 自定义比较器]（对象/数组字段引用恒变，需按值比较） */
export type BotFieldSpec =
  | keyof BotSummary
  | [keyof BotSummary, (a: unknown, b: unknown) => boolean];

/** 小对象按 JSON 串比较：modules（布尔组）/savedLocations（瘦身元信息）体量小，
 *  每 2s 一次 stringify 远比整棵 Tab 子树重渲便宜 */
export const eqJson = (a: unknown, b: unknown): boolean =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

export function memoBotTab<P extends { bot: BotSummary }>(
  Component: ComponentType<P>,
  fields: BotFieldSpec[],
): MemoExoticComponent<ComponentType<P>> {
  return memo(Component, (prev: P, next: P) => {
    const a = prev.bot;
    const b = next.bot;
    if (a !== b) {
      for (const spec of fields) {
        const [key, eq] = Array.isArray(spec)
          ? spec
          : ([spec, Object.is] as [keyof BotSummary, (x: unknown, y: unknown) => boolean]);
        if (!eq(a[key], b[key])) return false;
      }
    }
    // bot 以外的 props 浅比较（当前各 Tab 只有 bot，一并防御未来加 props 时静默失效）
    for (const k of Object.keys(next) as (keyof P)[]) {
      if (k === "bot") continue;
      if (!Object.is(prev[k], next[k])) return false;
    }
    return true;
  });
}
