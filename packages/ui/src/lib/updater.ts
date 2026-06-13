// 桌面版静默自动更新（不弹窗）：
// App 启动后台静默检查 GitHub Release → 有新版本静默下载 → 完成后只在角落亮个指示器，
// 用户点指示器才安装重启。全程不打断挂机。非 Tauri（浏览器）环境直接 no-op。
import { useStore } from "@/store/useStore";

type UpdateState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "downloading"; pct: number }
  | { phase: "ready"; version: string }
  | { phase: "error" };

// 模块级状态 + 订阅：UpdateBadge 组件订阅它渲染指示器（不进 zustand，避免污染主 store）
let state: UpdateState = { phase: "idle" };
const listeners = new Set<(s: UpdateState) => void>();
let readyUpdate: any = null; // 已下载、待安装的 Update 句柄

function setState(s: UpdateState) {
  state = s;
  for (const fn of listeners) fn(s);
}
export function getUpdateState(): UpdateState {
  return state;
}
export function subscribeUpdate(fn: (s: UpdateState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// 仅 Tauri 桌面壳内有 __TAURI__；浏览器/移动网页环境下整套更新逻辑 no-op
const isTauriShell = () => typeof (globalThis as any)?.__TAURI__ !== "undefined";

/** 启动后台静默检查并下载（不弹窗）。检查失败静默忽略——更新不是关键路径。 */
export async function checkAndDownloadSilently(): Promise<void> {
  if (!isTauriShell()) return;
  try {
    setState({ phase: "checking" });
    // 动态 import：插件 JS 只在桌面壳内可用，浏览器构建不应静态打进主 bundle
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update?.available) {
      setState({ phase: "idle" });
      return;
    }
    // 静默后台下载（不安装）：拆成只 download，让用户点指示器才安装——符合「不打断挂机」。
    let downloaded = 0;
    let total = 0;
    setState({ phase: "downloading", pct: 0 });
    await update.download((ev: any) => {
      if (ev.event === "Started") total = ev.data?.contentLength || 0;
      else if (ev.event === "Progress") {
        downloaded += ev.data?.chunkLength || 0;
        setState({ phase: "downloading", pct: total ? Math.round((downloaded / total) * 100) : 0 });
      }
    });
    readyUpdate = update;
    setState({ phase: "ready", version: update.version });
  } catch {
    setState({ phase: "error" });
    setTimeout(() => state.phase === "error" && setState({ phase: "idle" }), 8000);
  }
}

/** 用户点指示器：安装已下载好的更新并重启。 */
export async function installAndRestart(): Promise<void> {
  if (!readyUpdate) return;
  try {
    useStore.getState().pushToast("正在安装更新，即将重启…", "info");
    await readyUpdate.install();
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch {
    useStore.getState().pushToast("更新安装失败，请手动下载最新版", "error");
  }
}

/** 启动时调用一次：延迟到引擎连上、界面稳定后再后台检查（不抢启动资源）。 */
export function startUpdateWatcher(): void {
  if (!isTauriShell()) return;
  // 启动 30 秒后首检（让用户先看到界面/机器人连上）；之后每 6 小时复检一次
  setTimeout(() => {
    checkAndDownloadSilently();
    setInterval(checkAndDownloadSilently, 6 * 60 * 60 * 1000);
  }, 30_000);
}
