# 面向玩家的 Minecraft 挂机机器人客户端 — 设计与实施计划书

- 文档日期：2026-06-02
- 工作代号：`mc-bot-player`（正式产品名待定，见 §13）
- 来源项目：`G:\mineflayerbotapp`（面向服主的多用户管理系统，作为引擎与功能模块的复用来源）
- 文档性质：设计规格（spec）+ 分阶段实施路线图（计划书）

---

## 1. 背景与目标

### 1.1 从"服主版"到"玩家版"的转变

现有项目是一套**面向服主**的多用户 SaaS 式系统：网页注册/邮箱审核/登录、用户分级与配额、管理员面板、多租户隔离。它假设"一个管理员托管一套系统，给很多用户开账号"。

新项目**面向单个玩家**：玩家自己拥有并控制机器人，不需要账号体系，直接配置"连哪台引擎 + 连哪个 MC 服"。核心诉求是**让机器人 7×24 小时挂机，哪怕自己电脑关了也在跑**。

### 1.2 目标（成功标准）

1. 玩家无需任何"网页登录/注册"即可使用，**直接配置服务器连接**。
2. 提供**三个交付形态**：
   - **Docker 版**（引擎，24/7 常驻，机器人真正运行的地方）— 第一版核心。
   - **Windows 客户端**（Tauri 2，Claude Desktop 风格界面，遥控引擎）— 第一版核心。
   - **Android 客户端**（Tauri 2，与 Windows 同一套界面，遥控引擎）— 第一版核心。
3. 保留来源项目的**全部功能模块**（战斗、钓鱼、挖矿、农场、追怪、定时、计分板、可视化脚本等）。
4. 界面**美观**、交互**简单**（用户明确要求"不要太麻烦"）。
5. **性能**：单台 4G 内存主机可稳定挂多个机器人；客户端轻量、低占用。

### 1.3 非目标（本版不做 / YAGNI）

- 不做多用户/多租户/账号体系/管理员面板/邮箱。
- 不做网页托管界面（保留一个最小自检页即可，主界面在客户端）。
- 第一版**不做** Windows 内置引擎（架构预留，后续版本再加；见 §11 Phase B）。
- 不做应用商店上架流程（先产出可安装包，上架另议）。

---

## 2. 关键决策记录（已与用户确认）

| 决策点 | 结论 | 理由 |
|---|---|---|
| 运行拓扑 | **共享引擎 + 瘦客户端**（方案 A） | 引擎写一遍，UI 一套跨端复用；Android 才可行 |
| 主场景 | **24/7 常开**，引擎安家在 Docker 主机 | 用户核心需求 |
| 客户端外壳 | **Tauri 2**（Windows + Android 同壳同 UI） | 用户排斥 Electron；Tauri 包小、内存低、用系统 WebView，且 Tauri 2 支持安卓 |
| 连接认证 | **地址 + 访问令牌**（连接串 / 二维码），单主人、无账号 | 取代网页登录，最省事且安全 |
| 第一版范围 | **Docker 引擎 + Windows/Android 遥控**；Windows 内置引擎延后 | 最快可用，贴合 24/7 |
| 语言 | 引擎与 UI 均迁移到 **TypeScript**（JS 模块渐进迁移） | 重构期类型安全，降低踩坑 |
| UI 技术 | **React + Vite + Tailwind + shadcn 风格组件 + lucide 图标** | Claude Desktop 同款审美与生态；开发快 |
| 功能模块 | **全部保留**，逐个迁移到新 UI | 玩家都用得上，可视化脚本是差异化亮点 |
| 数据存储 | **JSON 文件**（无数据库），Docker 卷持久化 | 沿用现状，简单可靠 |

---

## 3. 总体架构

```
┌──────────────┐                          ┌──────────────────────────────────────┐
│ Windows 客户端 │  wss:// + 访问令牌         │  Docker 主机（24/7 常开 · VPS/小主机）    │
│  Tauri 2      │ ───────────────────────► │  ┌────────────────────────────────┐   │
│  (WebView2)   │ ◄─────────────────────── │  │ 引擎核心 Engine (Node + TS)       │   │
└──────────────┘     状态/日志/事件          │  │  · BotInstance × N (多机器人)     │   │
                                           │  │  · 功能模块 (combat/farm/...)     │   │      ⛏️
┌──────────────┐                          │  │  · WS + HTTP API (令牌鉴权·限速)  │ ─────► Minecraft
│ Android 客户端 │  wss:// + 访问令牌         │  │  · 配置文件存储 (JSON, 挂卷)      │   │      服务器
│  Tauri 2      │ ───────────────────────► │  └────────────────────────────────┘   │
│  (同一套 UI)   │ ◄─────────────────────── │  数据卷: bots.json / settings.json /   │
└──────────────┘                          │         token / user_scripts/         │
                                           └──────────────────────────────────────┘
```

- 客户端是**纯遥控瘦客户端**，不跑机器人逻辑。
- 引擎是**单主人**的：一个引擎 = 一个玩家的所有机器人，用一个访问令牌保护。
- 机器人在引擎进程内以 `BotInstance` 形式存在，登录到目标 MC 服。

---

## 4. 仓库结构（monorepo）

采用 pnpm workspaces 单仓库：

```
mc-bot-player/
├── packages/
│   ├── engine/            # 引擎核心 (Node + TS)，复用来源项目
│   │   ├── src/
│   │   │   ├── BotInstance.ts
│   │   │   ├── botManager.ts
│   │   │   ├── modules/           # combat/fishing/automine/auto_farm/...
│   │   │   ├── api/               # WS + HTTP，令牌鉴权
│   │   │   ├── config/            # JSON 存储、令牌生成
│   │   │   └── utils/             # logger/reconnectPolicy/chatSafety/...
│   │   ├── bin/serve.ts           # 启动入口（headless）
│   │   └── package.json
│   ├── ui/                # 共享界面 (React + Vite + TS + Tailwind)
│   │   ├── src/
│   │   │   ├── app/               # 布局、路由、主题
│   │   │   ├── features/          # bots/console/modules/script-editor/connect
│   │   │   ├── lib/               # socket 客户端、状态(zustand)、协议类型
│   │   │   └── components/ui/     # shadcn 风格基础组件
│   │   └── package.json
│   └── protocol/          # 客户端↔引擎共享的 TS 类型与事件常量
├── apps/
│   ├── desktop/           # Tauri 2 → Windows（加载 packages/ui 构建产物）
│   │   └── src-tauri/
│   └── mobile/            # Tauri 2 → Android（同上）
│       └── src-tauri/
├── docker/
│   ├── Dockerfile         # 引擎镜像（多阶段）
│   └── docker-compose.yml # 卷 + 重启策略 + 健康检查
├── docs/
├── pnpm-workspace.yaml
└── package.json
```

要点：
- `packages/protocol` 是**单一事实源**：定义所有 WS 事件名、命令/响应、状态结构的 TS 类型，引擎与 UI 同时 import，杜绝两端字段对不上。
- `packages/ui` 编译出纯静态资源，被 `apps/desktop` 和 `apps/mobile` 两个 Tauri 壳共同加载。

---

## 5. 现有代码复用 / 丢弃映射

### 5.1 复用（搬进 `packages/engine`，按需 TS 化）

| 来源 | 处理 |
|---|---|
| `BotInstance.js` | 核心保留；去掉 `ownerId`/`_room` 多用户定向，事件改为全局广播给已认证客户端 |
| `modules/*`（combat/fishing/automine/auto_farm/mob_hunter/inventory/player_inventory/interact/scheduler/scoreboard/script_engine/fishing_hotspot/mining/trash_cleaner） | 全部保留，接口不变 |
| `services/botManager.js` | 简化：删除 `ownerId` 过滤、用户配额、`getDashboard` 的权限分支；保留生命周期/登录调度/健康检查/内存监控/脚本存储 |
| `socket/handlers.js` | 去掉 session 鉴权与 `ownerId` 校验，改为**令牌握手鉴权**；事件词汇表保留（add_bot/toggle_module/send_chat/脚本相关等） |
| `routes/api.js` | 现成的令牌式外部控制 API，正好作为 HTTP API 基础 |
| `utils/*`（logger/reconnectPolicy/chatSafety/debouncedSave/guiMatch/validateEnv/passwordValidator） | 保留（passwordValidator 仅在需要"自设密码"时用） |
| `Dockerfile`/`docker-compose.yml`/`ecosystem.config.js` | 作为 `docker/` 起点改造 |

### 5.2 丢弃

`auth.js`、`routes/auth.js`、`routes/admin.js`、`users.json`、`accounts.json` 的多用户字段、`sessions/`、`session-file-store`、`express-session`、`bcryptjs`、`nodemailer`、`password_reset_tokens.json`、`public/login.html`、`public/reset-password.html`、`public/admin.html`、整套旧 `public/*` 网页界面（重做）。

---

## 6. 引擎设计（packages/engine）

### 6.1 进程与运行

- 单进程多机器人（沿用来源项目的"单进程 + 错误隔离"模型，内存友好）。
- headless 启动：`node bin/serve.js`（或 Docker `CMD`）。无浏览器界面，仅一个 `/health` 与最小自检页。
- 全局异常兜底（`uncaughtException`/`unhandledRejection`）沿用，单机器人崩溃不影响其他。

### 6.2 配置与存储（JSON，无数据库）

数据目录（Docker 卷 `/data`）：
- `bots.json`：机器人列表 `[{ id, name, host, port, version, mcAuth: 'offline'|'microsoft', loginPassword?, settings }]`（去掉 `ownerId`）。
- `settings.json`：引擎全局设置（监听端口、viewDistance 默认、限速参数、是否启用 TLS 等）。
- `token`：访问令牌（首次启动随机生成 32 字节 hex；可被 `ENGINE_TOKEN` 环境变量覆盖）。
- `user_scripts/`：可视化脚本库（沿用现有目录结构，去掉按 userId 分文件，改单库或单文件）。
- 写盘沿用 `debouncedSave` + 临时文件原子替换。

### 6.3 API：WebSocket + HTTP（令牌鉴权）

- **WebSocket（Socket.IO，沿用）**：连接握手携带 `auth: { token }`；校验失败拒绝。事件词汇表复用 `socket/handlers.js`（删除 `user`/`ownerId` 维度，按 `botId` 寻址）。负责：状态推送、日志流、模块状态、命令下发。
- **HTTP REST（Express，沿用）**：`Authorization: Bearer <token>`。负责：`GET /api/bots`、`POST /api/bots`、`DELETE /api/bots/:id`、`GET/PUT /api/bots/:id/settings`、`GET /api/health`、`GET /api/connection-info`（返回连接串/二维码用）、脚本 CRUD。
- **限速**：复用 `express-rate-limit`，对鉴权失败做退避，缓解公网爆破。

### 6.4 连接信息与配对

- 启动日志打印：引擎地址（自动探测内网/外网候选）、端口、令牌、一条**连接串** `mcbot://<host>:<port>?token=<token>`，以及一段**二维码**（终端 ASCII + `/api/connection-info` 返回 dataURL，供 Android 扫码）。
- 将来 Windows 内置引擎：自动 `localhost + 本地令牌`，零配置（架构预留）。

### 6.5 安全

- 公网暴露前提下：令牌是第一道闸；建议（文档指引）在 VPS 用 Caddy/Nginx 反代加 TLS，得到 `wss://`。
- 引擎也支持内置 TLS（自签 + 客户端首次连接指纹确认 TOFU），作为无反代时的兜底。
- `chatSafety` 命令黑名单沿用，防止脚本/聊天发出危险指令。

---

## 7. 客户端 UI 设计（packages/ui，Claude Desktop 风格）

### 7.1 设计语言

- 整体：**左侧栏 + 主内容区**双栏；窄边框、圆角卡片、留白充足、系统字体、克制的强调色。
- 主题：**深/浅色**双主题，跟随系统；强调色一处（可在主题里改）。
- 图标：lucide（来源项目已用，延续）。
- 交互原则：**少点几下能用**；危险操作二次确认；空状态有引导。

### 7.2 布局

```
┌───────────────────────────────────────────────────────────┐
│ 顶栏: [引擎连接状态●] 引擎名/地址        [主题切换] [设置]      │
├──────────────┬────────────────────────────────────────────┤
│ 侧栏          │ 主内容区（选中机器人）                          │
│  ● bot A     │  ┌── 状态头: 名称/坐标/血量/饥饿/等级/在线 ──┐  │
│  ○ bot B     │  状态头下: [重连][停止][发送聊天]              │
│  ○ bot C     │  ┌── Tab: 概览 | 模块 | 背包 | 脚本 | 日志 ─┐  │
│  ──────────  │  │  模块: 战斗/钓鱼/挖矿/农场/追怪/定时...   │  │
│  [+ 添加机器人]│  │  每个模块: 开关 + 参数 + 实时统计         │  │
│  ──────────  │  │  脚本: 可视化积木编辑器（移植现有）        │  │
│  连接的引擎    │  │  日志: 实时滚动 + 过滤                    │  │
└──────────────┴────────────────────────────────────────────┘
```

- 多机器人 → 侧栏列表（含在线状态点、关键指标）。
- 首次启动无连接 → **连接引导页**：粘贴连接串 / 填地址+令牌 / 扫码（移动端）。

### 7.3 技术与状态

- React + Vite + TypeScript + Tailwind + shadcn 风格组件；`zustand` 管全局状态；`socket.io-client` 连引擎。
- 通过 `packages/protocol` 共享事件/类型，端到端类型安全。
- 连接状态机：`disconnected → connecting → authenticating → online → (reconnecting) / auth-failed`；离线有横幅与重连。
- 列表/日志做**虚拟化**与**窗口化**（仅渲染可见项，日志保留近 N 条），保证多机器人下流畅。

### 7.4 功能模块迁移清单（逐个搬到新 UI）

战斗、钓鱼、自动挖矿、自动农场（6 作物+骨粉+补种）、追怪（区域/黑白名单/安全暂停）、背包与 GUI 容器操作、NPC 交互、定时任务、计分板/BossBar、地点管理、**可视化脚本编辑器**（积木拖拽/JSON 双模式/触发器/子脚本/运行时变量）。可视化脚本编辑器是工作量大头，单列子任务移植。

---

## 8. 通信协议与数据流

- 客户端连接 → 令牌握手 → 订阅 → 引擎推送：`bots:snapshot`（全量）、`bot:status`（增量，沿用现有去重/30s 保活）、`bot:log`、`module:state`、`bot:error`。
- 客户端下发命令：`bot:add/delete/reconnect/stop`、`module:toggle`、`module:config`、`bot:chat`、`script:save/start/stop/list`、`location:*`、`inventory:*`、`gui:click` 等（沿用现有事件，去 `user` 维度，加 `botId`）。
- 所有事件名与负载结构集中在 `packages/protocol`。

---

## 9. 错误处理与可靠性

- **引擎**：重连退避 + 致命踢出识别（不可恢复不空转重连）、cleanup 钩子全清、内存监控告警、原子写盘 —— 全部沿用。
- **客户端**：与引擎断线自动重连（指数退避）；离线横幅；命令乐观更新 + 服务端回执对账；鉴权失败明确提示重新配对。
- **Docker**：`restart: unless-stopped`、`HEALTHCHECK` 调 `/health`、数据挂卷防丢配置。

---

## 10. 测试策略

- **引擎单测**（`node --test` / vitest）：模块逻辑用 mock bot；令牌鉴权、配置读写、API 契约测试。
- **协议契约**：`packages/protocol` 类型 + 运行时校验（zod）双保险。
- **UI 组件测试**：Vitest + Testing Library；连接状态机、列表渲染、模块面板。
- **集成测试**：起引擎 + 本地离线测试服（PrismarineJS flying-squid 或 mock），跑"添加机器人→上线→开关模块→收日志"主链路。
- **端到端冒烟**：Tauri 桌面/安卓各出一个 debug 包，手动+脚本冒烟。
- 遵循 verification-before-completion：每阶段有可运行的验证命令与预期输出，跑过才算完成。

---

## 11. 分阶段实施路线图（计划书主体）

> 执行方式：用 `/loop` 自驱，**按阶段推进**；每阶段达成"验收标准"并通过验证后才进入下一阶段。每阶段产出可运行/可见的成果。

### Phase 0 — 脚手架与工具链
- 建 monorepo（pnpm workspaces）、TS 配置、lint/format；建 `packages/{engine,ui,protocol}`、`apps/{desktop,mobile}`、`docker/`。
- 把本计划书复制进新仓库 `docs/`。
- **验收**：`pnpm -r build` 通过；空壳引擎能 `node bin/serve` 启动并打印连接信息。

### Phase 1 — 引擎重构（核心）
- 搬入 `BotInstance`+`modules`+`botManager`+`utils`；剥离 auth/多用户；实现令牌鉴权的 WS+HTTP API、JSON 存储、连接信息/二维码；产出 Docker 镜像 + compose。
- **验收**：用脚本（或 curl + ws 客户端）连上引擎，添加 1 个机器人到测试服并上线，能收到状态/日志、能开关战斗/钓鱼；`docker compose up` 持久化生效、`/health` 正常。

### Phase 2 — 共享 UI MVP
- React+Tailwind+shadcn 搭 Claude Desktop 布局（顶栏/侧栏/主区/主题）；连接引导页；机器人列表 + 概览 + 日志 + 基础控制（聊天/重连/停止）；接 Socket.IO + protocol 类型。
- **验收**：浏览器里（dev）连真引擎，完成"配对→看到机器人在线→发聊天→看日志→重连/停止"。

### Phase 3 — Tauri 桌面（Windows）
- `apps/desktop` 用 Tauri 2 加载 UI 构建产物；连接串粘贴；原生窗口/托盘/开机自启；WebView2 引导；出 `.msi/.exe`。
- **验收**：Windows 安装包可装可启，连引擎跑通 Phase 2 全流程；包体与内存显著小于 Electron 基线。

### Phase 4 — 全功能模块 UI
- 逐个迁移：挖矿/农场/追怪/背包&GUI/NPC/定时/计分板/地点；**移植可视化脚本编辑器**（积木+JSON+触发器+子脚本+运行时变量）。
- **验收**：每个模块都能在客户端配置、启停、看实时统计；脚本能新建/保存/运行/停止，触发器生效。

### Phase 5 — Tauri 安卓
- `apps/mobile` 出 Android 工程；UI 响应式适配手机；二维码扫码配对；出签名 APK。
- **验收**：真机/模拟器装 APK，扫码连引擎，完成主流程；竖屏布局可用。

### Phase 6 — 界面美观打磨
- 视觉细节、动效、空状态、骨架屏、深浅色一致性、可访问性、i18n（中/英）、图标与排版统一；连接/错误/加载态打磨。
- **验收**：走查清单逐项通过；关键界面截图评审达"美观"标准。

### Phase 7 — 性能优化
- 引擎：viewDistance/区块内存调优、事件节流（沿用状态去重）、多机器人压测、内存基线与告警；
- 客户端：日志/列表虚拟化、bundle 体积、启动时长、网络负载（增量推送）、WebView 内存；
- **验收**：在 4G 主机挂 N 个机器人稳定运行（给出 N 的实测值）；客户端冷启动与内存达标（给出阈值）。

### Phase 8 — 测试、文档与发布
- 补齐单测/集成/契约测试与 CI（GitHub Actions 矩阵：引擎镜像、Windows、Android）；用户文档（部署 Docker、连接、各功能）；签名与发布产物。
- **验收**：CI 全绿；三种交付物可下载安装；README/部署文档完整。

### Phase B（后续版本，非本计划必须）— Windows 内置引擎
- Tauri sidecar 打包 Node 引擎，Windows 可"本机直接跑机器人"，localhost 零配置自动连。

---

## 12. 风险与对策

| 风险 | 对策 |
|---|---|
| Tauri 安卓相对年轻 | 客户端是 WebView 瘦壳用法，最成熟路径；早在 Phase 5 出包验证，问题早暴露 |
| 公网引擎被扫描爆破 | 令牌 + 限速 + TLS 指引；文档强烈建议反代 + 非默认端口 |
| mineflayer 集成测试难 | 用本地离线测试服/mock；主链路自动化 + 关键模块手测 |
| 可视化脚本编辑器移植量大 | 单列 Phase 4 子任务；可先 JSON 模式打通，再补积木拖拽 |
| 微软正版登录(microsoft auth) | 第一版以 offline 为主；正版登录设备码流程列为 Phase 4/可选项 |
| 自动构建需 Rust/Android SDK/Docker 工具链 | Phase 0 固化工具链与版本；CI 镜像统一环境 |

## 13. 待定项（不阻塞，执行中确认）

- 正式产品名与图标（工作名 `mc-bot-player`；候选：MineMate / 挂机喵 / BotDeck —— 执行中再定）。
- 是否需要"自设密码"作为令牌的替代（默认仅令牌）。
- i18n 首发语言范围（默认中/英）。
- 微软正版账号登录是否进第一版（默认 offline 优先）。

---

## 14. 验收的总定义（Definition of Done）

1. Docker 引擎可 24/7 运行、持久化、令牌保护、挂多个机器人。
2. Windows 与 Android 客户端均可安装，扫码/连接串配对，遥控全部功能模块，界面为 Claude Desktop 风格、深浅色、中/英文。
3. 性能达标（§11 Phase 7 阈值），测试与 CI 通过，文档齐全。
