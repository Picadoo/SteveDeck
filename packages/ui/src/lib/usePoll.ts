import { useEffect, useRef } from "react";
import { usePageVisible } from "./usePageVisible";

/**
 * 可见性感知的轮询 hook——此前同一套「立即拉一次 + setInterval + 页面隐藏暂停 + 卸载丢弃迟到响应」
 * 样板在 6 个组件里各手写一遍，其中两处还漏了可见性暂停（后台白打请求）。
 *
 * 行为：
 * - enabled 为真且页面可见时启动：先立即执行一次，再按 intervalMs 周期执行
 * - 页面切后台自动暂停；回前台（或 deps 变化）立即拉一次再续上周期
 * - fn 通过 ref 取最新闭包，fn 本身变化不重启轮询；interval/enabled/deps 变化才重启
 * - fn 收到 alive()：异步响应回来后先查 alive()，false 表示本轮已过期（卸载/重启），丢弃结果别 setState
 */
export function usePoll(
  fn: (alive: () => boolean) => void | Promise<void>,
  intervalMs: number,
  opts?: { enabled?: boolean; deps?: readonly unknown[] },
): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const visible = usePageVisible();
  const enabled = opts?.enabled ?? true;
  useEffect(() => {
    if (!enabled || !visible) return;
    let alive = true;
    const isAlive = () => alive;
    const tick = () => {
      void fnRef.current(isAlive);
    };
    tick();
    const t = setInterval(tick, Math.max(250, intervalMs));
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, visible, intervalMs, ...(opts?.deps ?? [])]);
}
