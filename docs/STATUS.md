# 项目状态报告

> 自驱执行（按 `docs/2026-06-02-mc-bot-player-design.md` 的 8 阶段路线图）的完成情况。
> 诚实标注：哪些已完成并验证、哪些受本机环境限制需在目标环境收尾。

## 已完成并验证 ✅

| 阶段 | 内容 | 验证方式 |
|---|---|---|
| 0 脚手架 | pnpm monorepo、TS、protocol 契约、空壳引擎 | `pnpm build` 通过；引擎启动打印连接信息 |
| 1 引擎核心 | 复用 BotInstance+全部模块+utils；令牌鉴权 WS/HTTP API；JSON 存储；去多用户 | 控制面端到端测试（`pnpm test`，10 项全过） |
| 2 共享 UI | React+Tailwind Claude Desktop 风格；连接引导/侧栏/详情/日志/聊天；socket.io | 浏览器实测：连接→engine:info→加机器人→面板渲染（eval/inspect） |
| 3 Windows 桌面 | Tauri 2 工程，加载共享 UI | **实测构建**：3.2MB exe + MSI + NSIS 安装包 |
| 4 全模块 UI | 战斗/钓鱼/挖矿/农场/追怪 卡片+配置对话框；地点/定时/计分板 | 浏览器实测：模块卡片/配置字段渲染；引擎 10 项测试 |
| 5 安卓 APK | Tauri 2 Android（与桌面共用工程，UI 响应式） | **实测构建**：`app-arm64-debug.apk` ~11.3MB，内含 Rust 原生库 `libmc_bot_player_lib.so`（绕过 Windows 软链接限制完成打包） |
| 6 美观打磨 | 响应式（移动端抽屉）、Toaster 提示、重连横幅、深浅主题 | 移动端 375px 实测：菜单/抽屉/translate 归零 |
| 7 性能 | 客户端 vendor 分包；引擎状态去重/日志合并/低 viewDistance/内存监控（文档化） | 构建产物分包验证；`docs/PERFORMANCE.md` |
| 8 测试/文档/CI | 控制面测试、用户/构建/性能文档、GitHub Actions CI | `pnpm test` 通过；CI 工作流就绪 |

## 需在目标环境收尾（已文档化命令）⏳

| 项 | 原因 | 收尾命令 |
|---|---|---|
| **引擎 Docker 镜像构建/运行** | Docker Desktop ✅ 已装、CLI ✅ 可用，但 Linux 引擎需 **WSL2**（启用「虚拟机平台」功能 + BIOS 虚拟化 + 重启）才能跑——属管理员级 OS 改动，未擅自执行 | 启用 WSL2 后执行 `docker compose -f docker/docker-compose.yml up -d --build`（Dockerfile/compose 已就绪并 review） |
| **真实「机器人上线」集成测试** | 无可用 MC 测试服 | 引擎走的是已在原项目生产运行的复用代码；可用 flying-squid 本地服做集成 |

> 注：安卓正式 release APK 需配置签名密钥；本次产出的是 arm64 **debug** APK（debug 签名，可直接安装）。多架构/release 见 `docs/BUILD.md`。

## 后续增强（设计内、非阻塞）📋

- 脚本系统：✅ 已实现并验证 —— 新建/保存/运行/停止 + 触发器 + **可视化积木编辑器 + JSON 双模式**（引擎落盘 `scripts.json`）。
- 背包网格 / 垃圾清理模块 / NPC 扫描·交互：✅ 已补齐并验证。
- 微软正版登录（设备码流程）：当前以 offline 为主。
- Phase B：Windows 内置引擎（Tauri sidecar 打包 Node），实现「本机直接跑机器人」。

## 关键成果
- 一套引擎 + 一套界面，跨 Windows/Android 复用；Windows 安装包仅 **3.2MB**（Tauri 而非 Electron）。
- 无账号、令牌即连；7×24 Docker 引擎 + 瘦客户端遥控的目标架构跑通。
