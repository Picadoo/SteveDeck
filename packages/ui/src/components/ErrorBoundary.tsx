import { Component, type ErrorInfo, type ReactNode } from "react";
import { TriangleAlert, RotateCw } from "lucide-react";

// 渲染错误边界：McText 解析服务器任意脏文本、AI 返回数据直渲、GUI 窗口渲染服务器菜单——
// 任何一处抛错以前会白屏整个应用，挂机监控直接失联（人不在场发现不了）。
// 用法：按区域包裹（App 主区域 / BotPanel 标签页），一个区域崩掉不连累侧栏与其他功能。
// 给 key（如当前 tab 名）可在切换时自动重置错误态。

interface Props {
  children: ReactNode;
  /** 崩溃区域名（展示给用户，如「当前标签页」），默认「此区域」 */
  label?: string;
}
interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 只记控制台（供报 issue 贴栈），不上报——本产品无遥测
    console.error(`[ErrorBoundary] ${this.props.label ?? "区域"}渲染崩溃:`, error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 p-6 text-center">
        <TriangleAlert className="h-8 w-8 text-warning" />
        <div>
          <div className="text-sm font-medium">{this.props.label ?? "此区域"}渲染出错</div>
          <div className="mx-auto mt-1 max-w-md break-all text-xs text-muted">
            {String(error?.message ?? error)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={this.reset}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 active:scale-95"
          >
            <RotateCw className="h-3.5 w-3.5" /> 重试
          </button>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition hover:text-fg active:scale-95"
          >
            刷新页面
          </button>
        </div>
        <div className="text-[11px] text-muted">
          机器人仍在引擎侧正常运行，仅界面渲染出错；若反复出现请附控制台报错反馈
        </div>
      </div>
    );
  }
}
