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

### Windows 上的符号链接限制（已实测并给出变通法）

本仓库已在 Windows 上**实测构建出 arm64 debug APK**（`app-arm64-debug.apk`，~11.3MB，内含 Rust 原生库）。
但 `tauri android build` 在打包阶段会把编译好的 `.so` **符号链接**进 `jniLibs`，而 Windows 默认禁止创建符号链接，报：
`Creation symbolic link is not allowed for this system ... use developer mode`。

两种解决：
1. **开启 Windows 开发者模式**（设置 → 隐私和安全性 → 开发者选项），然后正常 `tauri android build`。
2. **不需管理员的变通法**（本仓库采用）：Rust 已编译出 `.so` 后，手动复制再让 Gradle 跳过 rust 任务：
   ```bash
   cp src-tauri/target/aarch64-linux-android/release/libmc_bot_player_lib.so \
      src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/
   cd src-tauri/gen/android
   ./gradlew :app:assembleArm64Debug -x :app:rustBuildArm64Debug
   # 产物：app/build/outputs/apk/arm64/debug/app-arm64-debug.apk
   ```

> release APK 需配置签名密钥；多架构构建去掉 `--target aarch64` 即可。

## CI

`.github/workflows/ci.yml`：在 push/PR 时构建各包、运行引擎测试，并在 Windows runner 上构建桌面包。
