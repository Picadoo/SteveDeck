import { useEffect, useState } from "react";

/** 页面是否可见。隐藏时暂停拉取型轮询省流量电量；恢复可见时依赖变化触发 effect 重跑、立即拉一次。 */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}
