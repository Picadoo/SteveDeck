<p align="center">
  <img src="https://img.shields.io/badge/Minecraft-1.8--1.21+-brightgreen?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiI+PHJlY3QgZmlsbD0iIzU1OEIyRiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ii8+PHJlY3QgZmlsbD0iIzc5QTg0NyIgeD0iMiIgeT0iMiIgd2lkdGg9IjQiIGhlaWdodD0iNCIvPjxyZWN0IGZpbGw9IiM3OUE4NDciIHg9IjEwIiB5PSI4IiB3aWR0aD0iNCIgaGVpZ2h0PSI0Ii8+PC9zdmc+" alt="Minecraft">
  <img src="https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white" alt="Node">
  <img src="https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=white" alt="Tauri">
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/github/license/Picadoo/SteveDeck" alt="License">
</p>

# SteveDeck

**你的 Steve 舰队，一块甲板全管住。**

面向玩家的 Minecraft 挂机机器人控制台 — 引擎 7×24 跑在服务器上，Windows 桌面 / Android / 手机浏览器作为瘦客户端遥控，随时随地管理你的机器人大军。

---

## ✨ 核心功能

<table>
<tr>
<td width="50%">

### 🤖 托管模块（一键开关）
- **自动挖矿** — 矿脉跟随、搭方块脱困、区域选取 (sel1/sel2)、寻找模式
- **追怪系统** — 关键词/全部怪物模式、RPG 全息名牌识别、矩形区域限定
- **自动农场** — 收割·补种·骨粉催熟，六种作物
- **自动钓鱼** — 持杆自动抛竿收竿
- **自动战斗** — 杀戮光环，PVP/PVE 可切换
- **跟随** — 类 Baritone follow，按玩家名/关键词/最近
- **垃圾清理** — 自动丢弃腐肉等无用物品

</td>
<td width="50%">

### 🧩 积木脚本
- 可视化**触发器 + 动作**编辑器，零代码
- 保命触发器**抢占**正在运行的脚本
- 预置模板：挂机防踢、低血量回家、受伤反击、背包满存箱…
- 支持自定义 JS 脚本（进阶）

### 🗺️ 踩点系统
- 保存/命名地点，支持**多世界跳转**（附带到达指令链）
- 脚本引用地点名即可跨世界自动导航
- 死亡后自动返回原位

</td>
</tr>
</table>

### 📡 多端遥控

| 方式 | 说明 |
|---|---|
| **Windows 桌面** | Tauri 2 原生应用，内置引擎开箱即用 |
| **Android** | Tauri 2 Android 客户端 |
| **手机/平板浏览器** | 引擎内置网页客户端，打开即用，支持 PWA 添加到主屏 |
| **扫码直连** | 引擎启动时打印二维码 + 连接串 `mcbot://host:port?token=xxx` |

### 👁️ 实时视角

浏览器内的 Minecraft 3D 视角（基于 prismarine-viewer）—— 第一人称 / 第三人称切换，可视化操控机器人走位、查看周围环境，不用打开 MC 客户端。

---

## 🏗️ 项目结构

```
SteveDeck/
├── packages/
│   ├── protocol/    # 共享 TS 类型与事件常量（单一事实源）
│   ├── engine/      # 引擎核心：Node + mineflayer，WS/HTTP API
│   └── ui/          # React + Vite + Tailwind 共享界面
├── apps/
│   ├── desktop/     # Tauri 2 → Windows 客户端
│   └── mobile/      # Tauri 2 → Android 客户端
└── docker/          # 引擎 Docker 镜像与 compose
```

---

## 🚀 快速开始

### 开发环境

```bash
pnpm install
pnpm build              # 构建 protocol → engine → ui
pnpm start:engine       # 启动引擎（打印连接信息 + 二维码）
```

### Docker 部署（推荐生产环境）

```bash
# 复制环境变量模板
cp .env.example .env
# 编辑 .env，设置 ENGINE_PUBLIC_HOST=<你的公网IP>

# 一键启动
docker compose -f docker/docker-compose.yml up -d --build
```

引擎自带网页客户端 — 手机浏览器打开 `http://<服务器IP>:8723/` 即可使用。

### Windows 桌面版

```bash
pnpm -C apps/desktop tauri build    # 需要 Rust 工具链
```

---

## 🔗 连接模型

**无账号、无注册。** 引擎首次启动生成访问令牌，打印连接串与二维码。客户端填「引擎地址 + 令牌」或扫码即可遥控。

```
mcbot://119.91.120.244:8723?token=xxxxxxxx
```

---

## 🛡️ 安全特性

- 访问令牌鉴权，未授权连接被拒
- 聊天指令安全过滤（防注入恶意命令）
- 玩家检测自动暂停（追怪/战斗模块）
- 无破坏模式寻路（默认不挖不搭，保护地图）

---

## 📖 文档

| 文档 | 说明 |
|---|---|
| [使用指南](docs/USER_GUIDE.md) | 部署引擎、连接客户端、使用各功能 |
| [构建指南](docs/BUILD.md) | 引擎/Docker、Windows 桌面、Android 构建 |
| [性能说明](docs/PERFORMANCE.md) | 引擎与客户端的性能优化措施 |
| [项目状态](docs/STATUS.md) | 各阶段完成情况 |

---

## 🧰 一键命令速查

```bash
pnpm install                # 安装依赖
pnpm build                  # 构建所有包
pnpm test                   # 运行引擎测试
pnpm start:engine           # 本地启动引擎

# Docker
docker compose -f docker/docker-compose.yml up -d --build

# Windows 安装包
pnpm -C apps/desktop tauri build
```

---

## 📝 License

[MIT](LICENSE) &copy; 2026 Picadoo
