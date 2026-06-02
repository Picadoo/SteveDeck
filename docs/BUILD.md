# 构建指南

monorepo，使用 pnpm。先 `pnpm install`。

## 通用

```bash
pnpm install            # 安装依赖
pnpm build              # 构建 packages（protocol → engine → ui）
pnpm test               # 构建并运行引擎控制面测试
```

## 引擎（Docker 镜像）

> 需要：Docker。

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

本地直接跑（开发）：

```bash
pnpm start:engine       # 或 pnpm dev:engine（tsx 热重载）
```

## 桌面客户端（Windows）

> 需要：Rust（rustup，stable）+ MSVC（VS Build Tools / VS Community 的 C++ 工作负载）+ WebView2（Win10/11 多已预装）。
> 安装 Rust：访问 https://rustup.rs/ 或 `rustup-init.exe -y --profile minimal`。

```bash
pnpm -C apps/desktop tauri build
# 产物：
#   apps/desktop/src-tauri/target/release/mc-bot-player.exe
#   .../bundle/msi/mc-bot-player_<ver>_x64_en-US.msi
#   .../bundle/nsis/mc-bot-player_<ver>_x64-setup.exe
```

开发模式（热重载，自动起 UI dev server）：

```bash
pnpm -C apps/desktop tauri dev
```

图标（改了源图后重生成）：

```bash
pnpm -C apps/desktop run icon
```

## 安卓客户端（Android）

> Tauri 2 的移动端与桌面端共用同一个 `apps/desktop/src-tauri` 工程。
> 需要：Rust + Android SDK + NDK + JDK 17（本机已具备 JDK 17）。
> 设置环境变量 `ANDROID_HOME`、`NDK_HOME`（或 `ANDROID_NDK_ROOT`），并安装 Rust 的 Android 目标：
> `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`

```bash
cd apps/desktop
pnpm tauri android init      # 首次：生成 Android 工程到 src-tauri/gen/android
pnpm tauri android dev       # 真机/模拟器调试
pnpm tauri android build     # 产出 APK / AAB
```

UI 已做响应式适配（移动端汉堡抽屉 + 触摸友好），手机端连接用扫码即可。

> 注：本仓库的开发机未安装 Android SDK/NDK，安卓构建尚未本地实测；上述为标准 Tauri 2 Android 流程，装好 SDK 后即可执行。

## CI

`.github/workflows/ci.yml`：在 push/PR 时构建各包、运行引擎测试，并在 Windows runner 上构建桌面包。
