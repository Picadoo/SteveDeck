import { useEffect, useState } from "react";
import { Download, Loader2, ArrowUpCircle } from "lucide-react";
import { getUpdateState, subscribeUpdate, installAndRestart } from "@/lib/updater";

/**
 * 静默更新角落指示器（桌面版）：
 * - 后台检查/下载时不显示任何东西（不打断）；
 * - 下载完成（ready）才亮一个小绿色「↑ 新版本」按钮，点一下静默安装并重启；
 * - downloading 时显示一个不起眼的进度小点（可选，给个「在动」的反馈）。
 * 浏览器环境永远 idle，组件渲染 null。
 */
export default function UpdateBadge() {
  const [state, setState] = useState(getUpdateState());
  useEffect(() => subscribeUpdate(setState), []);

  if (state.phase === "ready") {
    return (
      <button
        onClick={() => installAndRestart()}
        title={`新版本 v${state.version} 已就绪，点击安装并重启`}
        className="flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success transition-colors hover:bg-success/25"
      >
        <ArrowUpCircle className="h-3 w-3" />
        新版本
      </button>
    );
  }
  if (state.phase === "downloading") {
    return (
      <span
        title={`正在后台下载更新 ${state.pct}%`}
        className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] text-muted"
      >
        <Download className="h-3 w-3" />
        {state.pct}%
      </span>
    );
  }
  if (state.phase === "checking") {
    return <Loader2 className="h-3 w-3 animate-spin text-muted/40" />;
  }
  return null; // idle / error：不占角落
}
