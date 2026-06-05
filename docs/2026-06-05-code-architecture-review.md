# mc-bot-player 代码与架构审查报告

- 审查日期：2026-06-05
- 审查范围：`packages/engine`、`packages/ui`、`packages/protocol`、`apps/desktop`、`apps/mobile`、`docker`、核心文档
- 审查方式：只读静态审查、子代理并行审查、关键依赖贴图目录本地检查
- 变更声明：本报告不包含代码修改建议的实施；审查过程中未修改业务代码

## 1. 总体结论

当前项目的总体方向是合理的：以 Docker/Node 引擎长期运行 mineflayer 机器人，以 Tauri + React 作为桌面/移动瘦客户端远程控制，配合 `packages/protocol` 做客户端与引擎共享契约。这种设计贴合“7×24 小时挂机、Windows/Android 只做遥控”的目标，避免把高内存、高连接复杂度的机器人逻辑放到客户端，是较好的实践。

主要问题不在总体架构方向，而在以下几个方面：

1. 物品贴图链路目前仍依赖 `item.name` 与启发式 alias 匹配，缺少 metadata/damage/variant 参与解析，因此部分旧版、变体、自定义菜单物品会无法命中贴图。
2. `protocol` 尚未成为完整单一事实源，仍存在裸字符串事件、隐式 `_bid` 字段、协议声明与实际处理路径不一致的问题。
3. 运行时输入缺少 schema 校验，Socket/HTTP payload 主要靠 TypeScript 编译期类型，外部输入仍可能污染状态或触发运行时异常。
4. 旧 JS 模块迁移到新 TS 控制面后，`any` 与动态方法较多，短期利于复用，长期会增加协议漂移和维护成本。
5. 安全边界适合单主人局域网使用，但公网暴露、自定义 JS、localStorage token、Tauri CSP 关闭等场景风险较高。
6. JSON 存储简单可用，但解析失败静默返回空对象/空数组，存在数据被后续保存覆盖的风险。

建议优先处理顺序：

1. 物品贴图诊断与解析修正。
2. `protocol` 收敛与运行时 schema 校验。
3. 存储容错与自定义 JS 隔离。
4. UI 连接/token 安全和 Tauri CSP。
5. 模块状态命名一致性与测试补齐。

## 2. 当前架构评价

### 2.1 架构概述

项目采用 pnpm monorepo：

- `packages/protocol`：客户端与引擎共享的事件名、命令名、类型定义。
- `packages/engine`：Node + TypeScript + mineflayer 引擎，包含 BotManager、BotInstance、功能模块、HTTP/Socket.IO API、JSON 存储。
- `packages/ui`：React + Vite + Tailwind + Zustand UI，作为桌面/移动共享前端。
- `apps/desktop`：Tauri 2 壳，加载 `packages/ui/dist`。
- `apps/mobile`：当前偏文档/占位，实际 Android 构建复用 desktop Tauri 工程。
- `docker`：引擎容器化交付。

主要数据流：

```text
Tauri/Browser UI
  -> socket.io-client auth.token
  -> packages/engine/src/server.ts Socket.IO 鉴权
  -> packages/engine/src/api/* 命令处理
  -> packages/engine/src/botManager.ts
  -> packages/engine/src/BotInstance.js
  -> mineflayer / 模块
  -> 旧事件名 / 模块事件
  -> botManager 翻译或透传
  -> UI Zustand store
  -> React 渲染
```

HTTP 数据流主要用于：

- `/health`
- `/api/connection-info`
- `/api/bots`
- `/api/observe/:id`
- `/api/explore/:id`
- `/api/ai/script/:id`
- `/textures/:version/...`

### 2.2 做得好的地方

#### 单主人 Docker 引擎 + 瘦客户端是合理实践

对 mineflayer bot 来说，MC 协议连接、路径规划、区块数据、插件模块、长期重连都更适合运行在稳定主机或容器里。桌面和 Android 客户端只做遥控与展示，可以显著降低客户端复杂度和资源占用。

优点：

- Android 不需要直接运行 mineflayer 和 Node 长任务。
- Windows/Tauri 包体小，用户体验优于 Electron。
- 一套 UI 可复用到浏览器、桌面、移动。
- Docker 引擎便于 7×24 小时运行和数据卷持久化。

#### `packages/protocol` 作为共享契约方向正确

`server.ts`、`handlers.ts`、`engine.ts` 等已引用 `@mcbot/protocol` 中的 `ServerEvents`、`ClientCommands`、类型定义。这个方向能减少前后端字段对不上的概率。

#### 命令 ack 机制基本统一

UI 的 `emitAck()` 与引擎侧 `ok()` / `fail()` 形成统一响应结构：

- `packages/ui/src/lib/engine.ts`
- `packages/engine/src/api/ack.ts`
- `packages/engine/src/api/handlers.ts`
- `packages/engine/src/api/moduleHandlers.ts`
- `packages/engine/src/api/scriptHandlers.ts`

这有利于 UI 做统一 loading、失败提示、超时处理。

#### 旧模块迁移策略务实

`BotInstance.js` 和 `modules/*.js` 仍是 CommonJS/JS，但被 `botManager.ts` 封装，旧事件由 `botManager.translate()` 翻译到新协议事件。这种策略降低了重写全部 mineflayer 模块的风险，适合当前阶段快速交付。

#### 重连与资源清理已有基础

`BotInstance.js` 中已有：

- `cleanupHooks`
- `timers`
- `statusTimer`
- `stableTimer`
- `reconnectAttempts`
- `reconnectBackoff`
- fatal kick 判断
- 状态签名去重

这些机制比简单断线即重连稳健。

#### UI 状态和交互已有基本可用性

`packages/ui` 已具备：

- 连接引导。
- 侧栏/移动抽屉。
- 日志上限 `MAX_LOG_LINES = 500`。
- 背包精简/完整模式。
- GUI 窗口可视化。
- toast。
- 主题切换。
- Vite vendor chunks。

## 3. 物品材质不显示问题专项分析

### 3.1 当前贴图数据流

#### 背包贴图链路

1. mineflayer 背包槽位：`bot.inventory.slots`
2. 引擎序列化：`packages/engine/src/modules/player_inventory.js`
   - `name`: 去色码展示名
   - `display`: 原始展示名
   - `count`: 数量
   - `texture`: `item.name`
3. Socket 事件：`player_inv_data`
4. UI 接收：`packages/ui/src/lib/engine.ts`
   - 以 `_bid || user` 写入 store
5. UI 渲染：`packages/ui/src/features/bot/InventoryTab.tsx`
   - `ItemIcon texture={item.texture}`
6. 贴图 URL：
   - `texBase = ${connUrl}/textures/${bot.version || "1.12.2"}`
7. `ItemIcon` 候选路径：`packages/ui/src/components/ItemIcon.tsx`
   - `${base}/_icon/${id}.png`
   - `${base}/items/${id}.png`
   - `${base}/blocks/${id}.png`
   - alias item/block fallback

#### GUI 窗口贴图链路

1. mineflayer 当前窗口：`bot.currentWindow.slots`
2. 引擎序列化：`packages/engine/src/modules/window_gui.js`
   - `id: it.name`
   - `name/display/count/lore/enchants`
3. Socket 事件：`window_open` / `window_update`
4. UI 接收：`packages/ui/src/lib/engine.ts`
5. UI 渲染：`packages/ui/src/features/bot/GuiWindow.tsx`
   - `ItemIcon texture={it.id}`
6. 贴图服务：`packages/engine/src/server.ts`
   - `/textures/:version/_icon/:name`
   - `getIconMap(version)` 根据 prismarine-viewer 资源目录、`minecraft-data`、`ICON_ALIAS` 做映射
   - 命中后 302 到真实 `/textures/:version/items|blocks/*.png`

### 3.2 本地依赖检查结果

本地 `prismarine-viewer` 资源目录存在，并且包含 `1.12.2` 与 `1.20.1`：

```text
prismarine-viewer/public/textures
versions: 1.10.2, 1.11.2, 1.12.2, 1.13.2, 1.14.4, 1.15.2, 1.16.1, 1.16.4, 1.17.1, 1.18.1, 1.19, 1.20.1, 1.21.1, 1.21.4, 1.8.8, 1.9.4
```

因此“本地完整安装环境下完全缺少 prismarine-viewer 资源”的概率较低。但在 Docker 精简部署或依赖安装异常时，`server.ts` 会静默跳过 `/textures` 挂载，届时所有贴图都会 404。

### 3.3 高概率根因排序

#### P0：只传 `item.name`，缺少 metadata/damage/variant，导致变体物品无法解析

证据：

- `packages/engine/src/modules/player_inventory.js`
  - `texture: item.name`
- `packages/engine/src/modules/window_gui.js`
  - `id: it.name`
- `packages/protocol/src/index.ts`
  - `InventoryItem.texture?: string`
  - `WindowSlot.id: string`

问题说明：

很多物品仅靠 `item.name` 无法唯一确定贴图，尤其是：

- 1.12.2 扁平化前的 metadata 型物品。
- 染料颜色。
- 羊毛、玻璃、陶瓦、木头、树叶、台阶等变体。
- 药水类型。
- 刷怪蛋。
- 鱼类变体。
- 自定义服务器菜单中用 NBT/damage 区分展示的物品。

当前协议没有传：

- `type`
- `metadata`
- `damage`
- 可辅助解析的 NBT 字段
- 引擎端预解析后的 icon path

因此 `_icon` 只能按字符串猜。猜不到就进入 UI fallback。

#### P1：贴图版本严格依赖 `bot.version`，版本目录不存在或不匹配会整批失败

证据：

- `packages/ui/src/features/bot/InventoryTab.tsx`
  - `/textures/${bot.version || "1.12.2"}`
- `packages/ui/src/features/bot/GuiWindow.tsx`
  - `/textures/${bot.version || "1.12.2"}`
- `packages/engine/src/server.ts`
  - `const dir = path.join(texRoot, version)`

本地检查显示 `1.12.2` 与 `1.20.1` 都存在，但如果机器人配置为未包含的版本，例如某些中间小版本，`items` / `blocks` listing 会为空，`_icon` 解析会失败。

#### P2：alias 覆盖不完整

证据：

- 引擎 alias：`packages/engine/src/server.ts` 的 `ICON_ALIAS`
- UI alias：`packages/ui/src/components/ItemIcon.tsx` 的 `TEX_ALIAS`

问题说明：

当前 alias 已覆盖部分常见差异，如 `golden_apple -> apple_golden`、`bow -> bow_standby`，但仍无法覆盖大量旧命名、变体、实体渲染物品。

尤其注意：引擎端 alias 比 UI 端更完整，UI 端只是 `_icon` 失败后的兜底，命中率更低。

#### P3：GUI 中玻璃类装饰槽被主动弱化，不是加载失败

证据：

- `packages/ui/src/features/bot/GuiWindow.tsx`
  - `const filler = !!it && /glass_pane|stained_glass/i.test(it.id || "")`
  - `const active = !!it && !filler`
  - 只有 `active` 才渲染 `ItemIcon`

因此菜单里的玻璃板、染色玻璃装饰边框会被 UI 故意弱化显示，看起来像“没贴图”。这属于 UI 设计逻辑，不是贴图服务失败。

#### P4：prismarine-viewer 缺失时 `/textures` 服务静默跳过

证据：

- `packages/engine/src/server.ts`
  - `require.resolve("prismarine-viewer/package.json")`
  - `catch { /* 精简版无 prismarine-viewer，跳过贴图静态服务 */ }`

如果 Docker deploy 或生产依赖缺失导致 prismarine-viewer 不存在，UI 会全部 fallback。

### 3.4 为什么会显示 fallback 图标

`ItemIcon` 的逻辑：

- `texture` 为空：直接显示 `Package` fallback。
- `texture` 非空：按候选 URL 逐个加载。
- 每次图片 `onError` 后 `stage + 1`。
- 当 `stage >= candidates.length` 时显示 fallback。

所以以下任意情况都会触发 fallback：

- payload 没传 `texture` / `id`。
- `texture` 是 mineflayer 名称，但不是贴图文件名。
- 版本目录不存在。
- `_icon` 映射没命中。
- `/items/:id.png` 和 `/blocks/:id.png` 都不存在。
- alias 缺失。
- `/textures` 服务没有挂载。

### 3.5 不改代码的验证步骤

#### 验证贴图服务是否可用

启动引擎后访问：

```bash
curl -I http://127.0.0.1:8723/textures/1.12.2/_icon/diamond_sword.png
curl -I http://127.0.0.1:8723/textures/1.20.1/_icon/diamond_sword.png
```

预期：

- 正常：`302`，`Location` 指向真实图片。
- 异常：`404` 或连接失败。

#### 验证具体失败物品

在 UI 背包完整模式中，tooltip 底部会显示：

```text
minecraft:{item.texture}
```

取该 id 访问：

```bash
curl -I http://127.0.0.1:8723/textures/当前版本/_icon/物品id.png
curl -I http://127.0.0.1:8723/textures/当前版本/items/物品id.png
curl -I http://127.0.0.1:8723/textures/当前版本/blocks/物品id.png
```

如果都 404，基本可确认是映射/资源问题，不是 React 渲染问题。

#### 用浏览器 DevTools 确认

Network 过滤：

```text
_icon
png
textures
```

重点观察：

- URL 中版本号是否正确。
- `_icon` 是 302 还是 404。
- 302 后目标图片是否 404。
- 是否所有 `/textures` 都失败。
- 是否只是 `glass_pane` 之类 GUI filler 被隐藏。

### 3.6 推荐修复方向

优先建议：引擎端统一解析图标，而不是让 UI 猜。

建议新增共享解析函数，输入：

```text
bot.version
item.name
item.type
item.metadata / damage
item.nbt
```

输出：

```text
textureId
iconPath
textureVersion
resolved: boolean
reason / tried
```

协议可扩展为：

```ts
interface InventoryItem {
  texture?: string;
  icon?: string;
  type?: number;
  metadata?: number;
  damage?: number;
}

interface WindowSlot {
  id: string;
  icon?: string;
  type?: number;
  metadata?: number;
  damage?: number;
}
```

UI 优先使用 `icon`，没有再使用现有 `_icon` fallback。

同时建议：

- `/textures/:version/_icon/:name` 支持版本回退。
- 增加只读诊断接口，例如 `/textures/:version/_debug/:name`。
- GUI filler 与图片加载失败在 UI 上区分显示。
- alias 自动基于 `minecraft-data` 与贴图文件清单生成，减少手写表维护。

## 4. 协议/API 审查

### 4.1 优点

- Socket.IO 握手 token 鉴权清晰：`packages/engine/src/server.ts`。
- HTTP Bearer token 基本可用：`requireToken()`。
- 命令 ack 统一：`CommandAck`、`ok()`、`fail()`。
- `botManager` 做事件翻译，降低旧模块迁移成本。
- `/health`、`/api/connection-info`、`bots:snapshot`、`bot:status` 等核心链路清楚。

### 4.2 主要问题

#### 高：protocol 仍不是完整单一事实源

证据：

- `packages/ui/src/lib/engine.ts` 仍有裸字符串事件：
  - `script_status`
  - `script_progress`
  - `script_error`
  - `script_vars`
  - `monitor_stats`
- 这些事件没有纳入 `packages/protocol/src/index.ts` 的 `ServerEvents`。

影响：

- 事件名与 payload 易漂移。
- 编译期无法约束脚本运行态、监听统计等关键实时事件。

#### 高：隐式 `_bid` 字段未写入协议类型

证据：

- `packages/engine/src/botManager.ts` 的 `makeBroadcaster(botId)` 会注入 `_bid`。
- `packages/ui/src/lib/engine.ts` 消费 `_bid?: string`。
- `packages/protocol/src/index.ts` 中 `INVENTORY`、`WINDOW_*` payload 只声明 `{ user: string; ... }`。

影响：

`_bid` 是同名机器人不同服务器时避免串台的关键字段，但协议层没有声明，属于隐式契约。

#### 中：location 命令声明与实际处理路径不一致

证据：

- `packages/protocol/src/index.ts` 声明：
  - `LOCATION_SAVE`
  - `LOCATION_DELETE`
  - `LOCATION_GOTO`
- 实际处理在 `packages/engine/src/api/moduleHandlers.ts` 的 `MODULE_ACTION`：
  - `location:save`
  - `location:delete`
  - `location:goto`

影响：

未来客户端如果直接按 `ClientCommands.LOCATION_SAVE` 发送，会没有处理器响应或超时。

#### 中：HTTP API 未纳入协议常量/schema

HTTP 路由目前直接写在 `server.ts`：

- `/api/connection-info`
- `/api/bots`
- `/api/observe/:id`
- `/api/explore/:id`
- `/api/ai/script/:id`

`protocol` 中只有部分响应类型，没有路由常量和请求/响应 schema。

影响：

Socket 和 HTTP 协议面分裂，未来容易出现参数名、响应结构不一致。

#### 高：运行时输入缺少 schema 校验

证据：

- `packages/engine/src/api/handlers.ts`
  - `BOT_ADD` 直接接收 `BotConfigInput`。
  - `BOT_UPDATE` 接收 `patch: any`。
  - `BOT_GOTO` 直接使用 `x/y/z`。
- `packages/engine/src/api/moduleHandlers.ts`
  - `MODULE_ACTION` 使用 `args: any`。
  - 多处 `Number(args.x)` / `Number(args.slot)` 未严格校验 `NaN`。
- `packages/engine/src/api/scriptHandlers.ts`
  - `SCRIPT_SAVE` 只检查 `name` 与 `steps[]`。
- `packages/engine/src/server.ts`
  - `/api/ai/script/:id` 只做粗校验。

影响：

外部输入可传任意结构，可能导致：

- 状态污染。
- 无意义配置落盘。
- 运行时异常。
- UI ack 超时或错误不可解释。

#### 中：ack 语义不完全严格

证据：

- `BOT_RECONNECT`：不检查 bot 是否存在，直接 `ok()`。
- `BOT_STOP`：不检查 bot 是否存在，直接 `ok()`。
- `SCRIPT_STOP`：实例不存在也可能 `ok()`。

影响：

客户端难以区分“执行成功”、“目标不存在”、“目标离线”、“方法不存在”。

### 4.3 建议

1. 将所有事件纳入 `ServerEvents` 与 payload 类型。
2. 显式声明 `_bid?: BotId`，或彻底改为统一使用 `id: BotId`。
3. location 命令统一为 direct command 或 `MODULE_ACTION`，不要两套声明。
4. 引入 `zod` 或类似工具做运行时 schema 校验。
5. 将 HTTP 路由与请求/响应类型也纳入 protocol。
6. 统一 ack 语义：不存在、离线、模块缺失、参数非法、执行失败应返回不同错误。
7. UI `emitAck()` 校验 ack 结构，异常响应视为错误。

## 5. Engine 运行时、模块与存储审查

### 5.1 做得好的地方

- `BotInstance` 对模块加载逐个 `try/catch`，单模块失败不影响其他模块。
- `reconnectPolicy.js` 对不可恢复踢出做 fatal 判断。
- `cleanupHooks` 和 `timers` 提供统一清理机制。
- `updateStatus()` 做状态签名去重，减少空推。
- 自动挖矿等模块已有部分 timer 管理意识。
- 控制面测试覆盖了基本鉴权、增删 bot、模块开关、健康检查。

### 5.2 主要风险

#### 严重：自定义 JS 是完整主机 RCE

证据：

- `packages/engine/src/modules/custom_js.js`
  - `new AsyncFunction(...)`
  - 注入 `require`
  - 暴露 `bot`、`mineflayer`、`api`
- `packages/engine/src/api/moduleHandlers.ts`
  - `js:run`
  - `ENGINE_ALLOW_JS=1` 后可运行

当前默认禁用是正确的，但一旦启用，持有令牌的人可以执行主机级任意 JS：

- 读取文件。
- 读取明文 bot 配置、登录密码、token。
- 执行系统命令。
- 阻塞事件循环。
- 影响所有 bot。

`stopCustomJs()` 只是设置 cancelled 标记，不能中断 CPU 死循环或同步阻塞。

建议：

- 保持默认禁用。
- 若必须开放，放到独立 worker/process。
- 不传 `require`。
- 限制 API 白名单。
- 加执行超时、内存限制和进程级隔离。

#### 严重：JSON 读取失败静默返回空，可能覆盖真实数据

证据：

- `packages/engine/src/storage.ts`
  - `loadBots() catch { return []; }`
  - `loadScripts() catch { return {}; }`
  - `loadCustomScripts() catch { return {}; }`

风险：

当 JSON 损坏、权限错误、读文件异常时，调用方无法区分“文件不存在”和“文件损坏”。后续保存可能把空数组/空对象写回，造成二次破坏。

建议：

- 区分文件不存在与解析失败。
- 解析失败时报警并保留原文件。
- 保存前生成 `.bak` 或时间戳快照。
- 保存失败向 API 返回明确错误。

#### 高：`auth` 未从 BotConfig 传入 BotInstance

证据：

- `packages/engine/src/botManager.ts`
  - `addBot()` 保存 `auth: input.auth ?? "offline"`
  - `toInstanceConfig(cfg)` 未传 `auth`
- `packages/engine/src/BotInstance.js`
  - `auth: this.config.auth || 'offline'`

影响：

Microsoft/online auth 配置会被运行时忽略，实际仍以 offline 启动。

建议：

- `toInstanceConfig()` 明确传入 `auth: cfg.auth`。
- 增加控制面测试覆盖非 offline 配置是否进入 BotInstance。

#### 高：部分延迟任务未纳入统一清理

证据：

- `packages/engine/src/BotInstance.js`
  - 自动登录 `setTimeout(..., 2000)`
  - `restoreModules()` 中 `setTimeout(..., RESTORE_DELAY)`
  - 其他 death、goto 等延迟逻辑也存在类似情况

风险：

断线/重连后旧 timeout 可能作用到新 bot 实例，导致：

- 重复恢复模块。
- 误发 `/login`。
- 误执行复活命令。
- 状态抖动。

建议：

- 所有 timeout 登记到 `this.timers`。
- 延迟回调校验连接代数/session id。

#### 高：聊天安全策略默认放行未知 slash 命令

证据：

- `packages/engine/src/utils/chatSafety.js`
  - slash 命令先检查 `ALLOWED_PREFIXES`
  - 否则只在 `BLOCKED_COMMANDS` 命中时拦截
  - 未命中黑名单的未知 slash 命令默认放行

风险：

Minecraft 插件生态命令非常多，黑名单难以覆盖全部危险命令。

建议：

- 对 slash 命令默认拒绝，仅允许白名单。
- 白名单按服务器/bot 可配置。

#### 高：模块状态命名不一致

证据：

- `packages/protocol/src/index.ts`
  - `ModuleName` 使用 `auto_farm`、`mob_hunter`、`trash_cleaner`
- `packages/engine/src/botManager.ts`
  - summary 使用 `autofarm`、`mobhunter`、`trashcleaner`
- `packages/engine/src/api/moduleHandlers.ts`
  - toggle 使用 `auto_farm`、`mob_hunter`、`trash_cleaner`

风险：

UI 模块开关、状态恢复、模块卡片显示可能出现不一致。

建议：

- 全链路统一模块名。
- `ModuleFlags` 与 `ModuleName` 对齐。
- 模块自动关闭/状态变化统一广播 `ServerEvents.MODULE_STATE`。

#### 中：单进程多 bot 缺少性能隔离

所有 bot、Socket、脚本、日志、JSON 保存都在同一 Node 事件循环。单个 bot 的自定义 JS、灾难性正则、同步阻塞、过量日志都可能影响全局。

建议：

- 高风险脚本独立进程。
- 高频模块做限流。
- 对用户正则增加长度/复杂度限制。
- 做多 bot 压力测试。

#### 中：日志缺少大小上限与统一脱敏

证据：

- `packages/engine/src/utils/logger.js`
- `BotInstance` 自动登录虽然未打印密码，但全局日志没有统一脱敏策略。

建议：

- 单日文件大小上限。
- token/password 脱敏。
- `JSON.stringify` 循环引用保护。

## 6. UI/Tauri/交付审查

### 6.1 优点

- React + Vite + Tailwind + Zustand 组合轻量，适合 Tauri。
- `packages/ui` 与 Tauri 壳分离，便于桌面/移动复用。
- `apps/desktop/src-tauri/tauri.conf.json` 中 `frontendDist` 指向共享 UI 构建产物，边界清楚。
- UI 有响应式抽屉、toast、连接状态横幅、日志上限、背包完整/精简模式。
- root monorepo 结构清楚。

### 6.2 主要风险

#### 高：Tauri CSP 关闭

证据：

- `apps/desktop/src-tauri/tauri.conf.json`
  - `security.csp: null`

风险：

桌面/移动 WebView 一旦出现 XSS 或不安全富文本渲染，CSP 关闭会放大影响。

建议：

- 配置最小可用 CSP。
- 允许必要的引擎连接、图片资源和 WebSocket，但限制 script/style/source。

#### 高：token 存在 localStorage

证据：

- `packages/ui/src/lib/engine.ts`
  - `LS_KEY = "mcbot.connection"`
  - `localStorage.setItem(... { url, token })`

风险：

访问令牌是引擎控制凭证。若 WebView 或 UI 存在 XSS，token 可被读取。

建议：

- 桌面/移动使用 Tauri 安全存储/keychain 插件。
- Web fallback 才用 localStorage。
- 避免在 UI 长时间明文展示 connection string token。

#### 中：`engine.ts` 成为连接/API/事件总线巨石

证据：

- `packages/ui/src/lib/engine.ts`
  - `connect()`
  - 所有 `socket.on(...)`
  - HTTP fetch
  - 所有 `cmd` 封装

风险：

随着协议扩展，测试和维护会越来越困难。

建议拆分：

```text
lib/engine/connection.ts
lib/engine/events.ts
lib/engine/commands/*.ts
lib/engine/http.ts
```

#### 中：Zustand 单 store 过宽

证据：

- `packages/ui/src/store/useStore.ts`
  - 连接、bots、日志、背包、窗口、脚本状态、监听统计、toast、主题等都在一个 store

风险：

高频更新的日志/统计/背包可能增加重渲染压力，状态边界不清。

建议：

- 拆成 slice。
- 高频 socket 事件批处理或 debounce。
- 更细粒度 selector。

#### 中：日志列表未虚拟化

`Console.tsx` 目前通过上限 500 控制规模，短期可接受。但如果高频日志、复杂 `McText` 渲染、过滤/复制全部叠加，仍可能卡顿。

建议：

- 日志行 memo。
- 虚拟列表。
- 高频 append 批处理。

#### 中：移动端入口边界不够独立

`apps/mobile` 当前更像占位，Android 实际复用 desktop Tauri 工程。短期省事，长期会遇到：

- 权限。
- manifest。
- 图标。
- 签名。
- Deep link。
- 扫码能力。
- 平台差异配置。

建议后续让 `apps/mobile` 成为更明确的移动交付入口或至少承载独立配置说明。

#### 低：root 构建语义容易混淆

证据：

- root `package.json`
  - `build`: 只构建 `packages/*`
  - `build:all`: `pnpm -r build`

建议：

- `build:packages`
- `build:engine`
- `build:ui`
- `build:desktop`
- `build:android`
- `build:all`

## 7. 安全评价

### 7.1 当前安全模型适用场景

当前模型适合：

- 单主人。
- 局域网或可信网络。
- Docker/VPS 引擎由本人管理。
- token 作为简单配对凭证。

### 7.2 公网场景风险

如果直接公网暴露 `0.0.0.0:8723`，风险上升：

- Socket.IO CORS `origin: "*"`。
- Express `cors()` 全开放。
- token 在 connection string 和 localStorage 中存在。
- 自定义 JS 一旦启用等于持令牌 RCE。
- HTTP/Socket 命令无统一频控。

建议公网部署必须文档化：

- HTTPS/WSS 反代。
- VPN/Tailscale/ZeroTier 优先。
- 强 token。
- 不启用 `ENGINE_ALLOW_JS=1`。
- 可选限制 CORS origin。
- Socket 命令频控。

## 8. 测试与验证缺口

当前 `packages/engine/test/control-plane.cjs` 主要覆盖控制面 happy path。建议补齐：

### 8.1 贴图链路测试

- `_icon` 对典型物品返回 302。
- 版本不存在时返回明确 404 或 fallback。
- 变体/metadata 解析。
- Docker 生产部署中 `/textures` 是否可用。

### 8.2 协议测试

- 所有 `ClientCommands` 都有处理器或明确标记未实现。
- 所有裸字符串事件纳入 protocol。
- `_bid` payload 类型与实际一致。
- ack 结构校验。

### 8.3 存储测试

- 损坏 JSON。
- 空文件。
- 权限失败。
- `.tmp` 残留。
- 并发保存脚本。

### 8.4 BotInstance 生命周期测试

- spawn/end/kicked/reconnect。
- fatal kick 停止重连。
- cleanup 清理所有 timer。
- 同 username 不同 host 的 `_bid` 路由。

### 8.5 安全测试

- `ENGINE_ALLOW_JS` 默认禁用。
- 自定义 JS 启用边界。
- chatSafety 对未知 slash 命令行为。
- 令牌错误、空 token、超长 token。

### 8.6 UI 测试

- 连接状态机。
- ack 失败 toast。
- Inventory/GuiWindow 贴图 fallback。
- 日志高频渲染。
- 移动端抽屉与 Modal 行为。

## 9. 优先级行动清单

### 9.1 立即优先

1. 贴图诊断：确认失败物品 id、版本、`_icon` 返回状态。
2. 在物品 payload 中增加 `type/metadata/damage` 或 `icon`。
3. 修复 `auth` 未传给 `BotInstance`。
4. 把 `_bid`、`script_*`、`monitor_stats` 纳入 protocol。
5. JSON 读取失败不再静默返回空。

### 9.2 短期增强

1. 引入 zod/valibot 校验 Socket/HTTP payload。
2. 统一模块命名。
3. 明确 ack 错误语义。
4. 所有延迟任务纳入 timer 管理。
5. Tauri CSP 最小化配置。
6. token 存储改用安全存储。

### 9.3 中期优化

1. `engine.ts` 拆分连接、事件、命令、HTTP API。
2. Zustand 拆 slice。
3. 日志虚拟化与 socket 事件批处理。
4. 自定义 JS 独立进程/worker 隔离。
5. Android 交付入口独立化。
6. 增加 CI 测试矩阵和 Docker 贴图服务验证。

## 10. 分模块风险表

| 区域 | 风险等级 | 主要问题 | 代表文件 |
|---|---:|---|---|
| 物品贴图 | 高 | 只靠 `item.name`，缺少 metadata/variant；版本和 alias 兜底不足 | `player_inventory.js`、`window_gui.js`、`ItemIcon.tsx`、`server.ts` |
| 协议契约 | 高 | 裸字符串事件、隐式 `_bid`、命令声明与实际路径不一致 | `protocol/src/index.ts`、`ui/src/lib/engine.ts`、`api/moduleHandlers.ts` |
| 输入校验 | 高 | 外部 payload 无运行时 schema | `api/handlers.ts`、`api/moduleHandlers.ts`、`api/scriptHandlers.ts` |
| 自定义 JS | 严重 | 启用后完整 RCE，无法真正中断同步阻塞 | `modules/custom_js.js`、`api/moduleHandlers.ts` |
| 存储 | 严重 | JSON 解析失败静默返回空，可能覆盖真实数据 | `storage.ts` |
| Bot auth | 高 | `auth` 保存但未传入 BotInstance | `botManager.ts`、`BotInstance.js` |
| 生命周期 | 高 | 部分 timeout 未纳入统一清理 | `BotInstance.js` |
| UI 安全 | 高 | CSP 关闭，token 存 localStorage | `tauri.conf.json`、`ui/src/lib/engine.ts` |
| UI 维护 | 中 | `engine.ts` 巨石、单 store 过宽 | `ui/src/lib/engine.ts`、`store/useStore.ts` |
| 交付 | 中 | mobile 边界不够独立，root build 语义易混淆 | `apps/mobile`、root `package.json` |

## 11. 设计是否属于较好实践

结论：总体是较好实践，但还处在“功能跑通、工程边界需要收敛”的阶段。

好的实践包括：

- 机器人长期运行逻辑放在服务端/容器。
- 客户端瘦化，桌面/移动共享 UI。
- monorepo 分 protocol/engine/ui/app 壳。
- 使用 token 配对避免账号系统复杂度。
- 使用 JSON 存储符合单主人轻量目标。
- 旧模块通过 BotManager 适配迁移，降低重写风险。

需要避免演变成坏实践的点：

- `protocol` 不能只做部分类型定义，必须成为完整契约。
- JS 旧模块和 TS 新控制面之间需要逐步建立 typed interface。
- 安全不能长期停留在“局域网可信”假设。
- 自定义 JS 必须被视为高危能力，而不是普通脚本功能。
- JSON 存储必须具备损坏恢复能力。
- 贴图解析应从 UI 猜测迁移到 engine 统一解析。

如果按上述方向收敛，当前架构可以继续沿用，不需要推倒重来。
