# @mcbot/mobile — Android 客户端

Tauri 2 的移动端与桌面端**共用同一个** `apps/desktop/src-tauri` 工程与同一套 `packages/ui` 界面，
因此 Android 不需要独立的 Rust 工程——在 `apps/desktop` 下执行 `tauri android` 系列命令即可。

构建步骤见 [`docs/BUILD.md`](../../docs/BUILD.md#安卓客户端android)。

本目录保留为占位与文档锚点（pnpm workspace 成员）。UI 已做响应式与触摸适配，
移动端连接引擎用扫码（引擎 `/api/connection-info` 返回二维码）。
