<p align="center">
  <img src="https://img.shields.io/badge/Minecraft-1.8--1.21+-brightgreen?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiI+PHJlY3QgZmlsbD0iIzU1OEIyRiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ii8+PHJlY3QgZmlsbD0iIzc5QTg0NyIgeD0iMiIgeT0iMiIgd2lkdGg9IjQiIGhlaWdodD0iNCIvPjxyZWN0IGZpbGw9IiM3OUE4NDciIHg9IjEwIiB5PSI4IiB3aWR0aD0iNCIgaGVpZ2h0PSI0Ii8+PC9zdmc+" alt="Minecraft">
  <img src="https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white" alt="Node">
  <img src="https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=white" alt="Tauri">
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/License-Non--Commercial-orange" alt="License">
</p>

# SteveDeck

**不只是挂机——你能在浏览器里「玩」这个机器人。**

Minecraft 挂机机器人控制台，引擎 24/7 跑在 Docker 上，Windows / Android / 手机浏览器作为客户端遥控。核心差异点：**完整的实时交互系统**——3D 视角、键盘操控、背包管理、GUI 窗口点击、聊天字幕，像是在浏览器里打开了一个低配 MC 客户端。

<p align="center">
  <img src="docs/screenshots/实时视角截图.png" alt="3D 实时视角" width="820">
</p>

---

## 👁️ 实时交互（不是只能看日志的 bot）

这是 SteveDeck 和大多数 MC bot 的根本区别：

- **3D 实时视角** — 基于 prismarine-viewer 的浏览器内 Minecraft 画面，第一 / 第三人称切换，点击地面走位
- **键盘直控** — WASD 移动、空格跳跃、Shift 潜行，像在玩 MC
- **背包管理** — 完整背包界面，拖拽 / 丢弃 / 使用物品 / 装备武器防具，不改主手还原
- **GUI 窗口** — 打开箱子、村民交易、服务器菜单，点击槽位操作，支持按名字/Lore 搜索按钮
- **聊天字幕** — 聊天消息和 ActionBar 浮在 3D 视角上方，像游戏内 HUD
- **告示牌 / 书本** — 读取告示牌内容、翻阅成书

> 你的机器人不是一个黑盒——你随时能看到它在做什么、它看到了什么，并且直接接管操作。

<table>
  <tr>
    <td align="center" width="50%"><img src="docs/screenshots/背包界面截图.png" alt="背包管理"><br><sub>背包管理 · 拖拽 / 装备 / 使用 / 潜行使用</sub></td>
    <td align="center" width="50%"><img src="docs/screenshots/概览界面截图.png" alt="概览界面"><br><sub>概览 · 状态 / 坐标 / 实时指标</sub></td>
  </tr>
</table>

---

## 🤖 自动化模块

一键开关，配置后全自动挂机：

| 模块 | 说明 |
|---|---|
| **自动挖矿** | 矿脉跟随、Baritone 式区域选取 (sel1/sel2)、搭方块脱困、Find 探矿模式 |
| **追怪系统** | 关键词 / 全部怪物两种模式，RPG 全息名牌识别，矩形区域限定，玩家在旁自动装死 |
| **自动农场** | 收割 · 补种 · 骨粉催熟，六种作物 |
| **自动钓鱼** | 持杆自动抛竿收竿 |
| **自动战斗** | 杀戮光环，PVP/PVE 可切 |
| **跟随** | 类 Baritone follow，按玩家名 / 关键词 / 最近 |
| **垃圾清理** | 自动丢弃腐肉等垃圾 |
| **日志监听** | 自定义规则匹配聊天 / 系统消息，触发提醒或动作 |

<table>
  <tr>
    <td align="center" width="50%"><img src="docs/screenshots/内置模块截图.png" alt="模块面板"><br><sub>托管模块 · 一键开关 + 运行统计</sub></td>
    <td align="center" width="50%"><img src="docs/screenshots/日志监听规则截图.png" alt="日志监听规则"><br><sub>日志监听 · 自定义匹配规则</sub></td>
  </tr>
</table>

---

## 🧩 积木脚本

零代码的**触发器 + 动作**可视化编辑器：

- 血量低于阈值 → 自动回家 / 吃药
- 背包满了 → 去指定箱子存物品
- 被攻击 → 装备武器反击
- 定时 → 跳一下防踢 / 执行命令
- 保命触发器（血量 / 受伤）**可以抢占**正在运行的脚本
- 步骤可上下调序、任意位置中间插入，预置 8 个常用模板
- 支持自定义 JS 脚本（进阶）

**🧠 AI 脚本助手** — 接入 DeepSeek / 任意 OpenAI 兼容接口（Key 存引擎端，不进浏览器）：用大白话描述目标即可生成脚本；**Agent 模式**更进一步——生成 → 自动运行 → 观测执行结果 → 修正，闭环自动调试，而非一次性盲生成。

<p align="center">
  <img src="docs/screenshots/脚本编辑器截图.png" alt="积木脚本" width="820">
</p>

---

## 👥 批量假人（氛围组）

服主撑门面用——批量创建**轻量 lite 机器人**充人数：

- **轻量模式** — 只连接 + 自动注册/登录 + 防挂机踢，不挂功能模块，单只占用极低，可批量挂几十个
- **自然起名** — 多风格混杂、无连号规律，不会一眼看出是假人
- **登录服支持** — 首次进服自动注册、之后自动登录（AuthMe 等）
- **先试连后批量** — 第一个假人连上了才批量创建其余，避免地址填错白创一堆
- **按服管理** — 侧栏折叠分组，批量上线 / 下线 / 删除按服务器粒度

<p align="center">
  <img src="docs/screenshots/添加假人界面截图.png" alt="批量假人" width="640">
</p>

---

## 📡 多端接入

| 方式 | 说明 |
|---|---|
| **Windows 桌面** | Tauri 2 原生应用，内置引擎开箱即用，支持静默自动更新 |
| **Android** | Tauri 2 客户端 |
| **手机浏览器** | 引擎内置网页客户端 `http://<IP>:8723/`，支持 PWA |
| **扫码** | 引擎启动打印二维码 + 连接串 `mcbot://host:port?token=xxx` |

**无账号、无注册。** 引擎启动生成令牌，填地址 + 令牌（或扫码）即连；版本留空自动识别，地址支持 `host:port`。

<table>
  <tr>
    <td align="center" width="50%"><img src="docs/screenshots/添加机器人界面截图.png" alt="添加机器人"><br><sub>添加机器人 · 离线 / 微软正版 / Forge</sub></td>
    <td align="center" width="50%"><img src="docs/screenshots/总设置截图.png" alt="设置"><br><sub>设置 · 主题 / 连接 / 引擎</sub></td>
  </tr>
</table>

---

## 🏗️ 项目结构

```
SteveDeck/
├── packages/
│   ├── protocol/    # 共享 TS 类型与事件常量
│   ├── engine/      # Node + mineflayer 引擎，WS/HTTP API
│   └── ui/          # React + Vite + Tailwind 共享界面
├── apps/
│   ├── desktop/     # Tauri 2 → Windows
│   └── mobile/      # Tauri 2 → Android
└── docker/          # Docker 镜像与 compose
```

---

## 🚀 快速开始

```bash
# 开发
pnpm install && pnpm build && pnpm start:engine

# Docker 部署（推荐）
cp .env.example .env          # 编辑 ENGINE_PUBLIC_HOST=<公网IP>
docker compose -f docker/docker-compose.yml up -d --build
# 手机浏览器打开 http://<IP>:8723/ 即可使用

# Windows 安装包
pnpm -C apps/desktop tauri build    # 需要 Rust
```

---

## 📖 文档

- [使用指南](docs/USER_GUIDE.md) — 部署、连接、功能说明
- [远程访问 / 内网穿透](docs/REMOTE_ACCESS.md) — 家里主机跑引擎，手机在外网遥控
- [构建指南](docs/BUILD.md) — 引擎 / Docker / 桌面 / Android
- [AI 集成](docs/AI_INTEGRATION.md) — 接入 DeepSeek / OpenAI 兼容接口
- [性能说明](docs/PERFORMANCE.md) — 引擎与客户端优化

---

## 🙏 致谢

SteveDeck 站在 [PrismarineJS](https://github.com/PrismarineJS) 生态的肩膀上，引擎核心由这些优秀的开源项目驱动：

- [**mineflayer**](https://github.com/PrismarineJS/mineflayer) — 强大的 Minecraft 机器人框架，本项目的引擎基石
- [**prismarine-viewer**](https://github.com/PrismarineJS/prismarine-viewer) — 浏览器内 3D 实时视角渲染
- [**mineflayer-pathfinder**](https://github.com/PrismarineJS/mineflayer-pathfinder) — A* 寻路
- [**minecraft-data**](https://github.com/PrismarineJS/minecraft-data) — 跨版本游戏数据

桌面端由 [Tauri](https://tauri.app) 构建。感谢这些项目的维护者们。

## 📝 License

**[非商业许可](LICENSE)** — 个人 / 学习 / 研究 / 非营利用途免费使用、修改、分发；**商业用途需事先取得作者书面授权**（销售、付费产品/服务、商业盈利运营等）。商业授权请通过本仓库联系作者。

> 第三方依赖（mineflayer、prismarine-viewer 等）各自采用其原有开源协议（多为 MIT），本协议不改变这些组件的授权条款。
