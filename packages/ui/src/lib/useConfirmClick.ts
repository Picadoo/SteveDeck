import { useEffect, useRef, useState } from "react";

/**
 * 轻量两段式确认：第一次点进入「确认?」态（按钮变红），2.5s 内再点才执行，超时自动还原。
 * 适合列表项级的小型破坏操作（丢整组/重置统计/删单条），比弹窗确认少一次打断。
 * resetKey：操作目标的身份键——目标变化时自动解除待确认态（如背包行按槽位渲染，
 * 2.5s 窗口内物品滑动换位会让第二次点击丢错东西；身份变了必须重新确认）。
 * 用法：const del = useConfirmClick(() => doDelete()); <button onClick={del.onClick}>{del.arming ? "确认?" : "删除"}</button>
 */
export function useConfirmClick(action: () => void, timeoutMs = 2500, resetKey?: unknown) {
  const [arming, setArming] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    // 目标身份变化：解除待确认（mount 时跑一次也无害——本就未 arming）
    setArming(false);
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, [resetKey]);
  const onClick = () => {
    if (arming) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setArming(false);
      action();
    } else {
      setArming(true);
      timer.current = setTimeout(() => setArming(false), timeoutMs);
    }
  };
  return { arming, onClick };
}
