# mc-bot-player

面向**玩家**的 Minecraft 挂机机器人。引擎 7×24 跑在 Docker 上，桌面（Windows）与手机（Android）作为瘦客户端遥控。

- 设计与实施计划书：[`docs/2026-06-02-mc-bot-player-design.md`](docs/2026-06-02-mc-bot-player-design.md)

## 结构（monorepo）

| 包 | 说明 |
|---|---|
| `packages/protocol` | 客户端↔引擎共享的 TS 类型与事件常量（单一事实源） |
| `packages/engine` | 引擎核心（Node + TS + mineflayer），headless，令牌鉴权的 WS/HTTP API |
| `packages/ui` | 共享网页界面（React + Vite + Tailwind），桌面/手机共用 |
| `apps/desktop` | Tauri 2 → Windows 客户端 |
| `apps/mobile` | Tauri 2 → Android 客户端 |
| `docker/` | 引擎镜像与 compose |

## 快速开始（开发）

```bash
pnpm install
pnpm build              # 构建所有包
pnpm start:engine       # 启动引擎，打印连接信息（地址 + 令牌 + 连接串）
```

## 连接模型

- 无账号、无注册。引擎首次启动生成**访问令牌**并打印**连接串**与二维码。
- 客户端填「引擎地址 + 令牌」（或扫码）即可遥控。

## 文档

- [使用指南](docs/USER_GUIDE.md) — 部署引擎、连接客户端、使用各功能
- [构建指南](docs/BUILD.md) — 引擎/Docker、Windows 桌面、Android
- [性能说明](docs/PERFORMANCE.md) — 引擎与客户端的性能措施
- [项目状态](docs/STATUS.md) — 各阶段完成情况与收尾项
- [设计与计划书](docs/2026-06-02-mc-bot-player-design.md)

## 一键命令

```bash
pnpm install
pnpm build          # 构建 protocol + engine + ui
pnpm test           # 构建并运行引擎控制面测试（10 项）
pnpm start:engine   # 本地启动引擎
docker compose -f docker/docker-compose.yml up -d --build   # 引擎 24/7（需 Docker）
pnpm -C apps/desktop tauri build                            # Windows 安装包（需 Rust）
```

## 服务器/公网部署要点

- Docker 镜像自带**网页客户端**：手机/电脑浏览器打开 `http://<服务器>:8723/` 即是完整界面（支持 PWA 添加到主屏幕）。
- 公网部署设 `ENGINE_PUBLIC_HOST=<公网IP或域名>`（compose 经 `.engine-env` 注入）——连接串/二维码/扫码直连都用它。
- 防火墙放行 **8723**（主端口）与 **8800-8853**（实时视角端口池）。
- 自动化部署参考 `docker/deploy-tencent.ps1`：服务器清单放 `docker/deploy-targets.local.json`（已 gitignore，复制 `deploy-targets.example.json` 改名填写）。
- 环境变量清单见 [.env.example](.env.example)。

## License

[MIT](LICENSE)
