# mc-bot-player 代码审查报告（只读全面审查）

- **日期**：2026-06-07
- **范围**：全仓 ~16,300 行源码（`packages/protocol`、`packages/engine`、`packages/ui`、`apps/desktop`），不含 `node_modules`/构建产物/测试数据
- **方式**：7 个并行只读子代理分区审查 + 主代理对高危/被多方独立印证的结论逐条复核（读取实际行号验证，无任何代码改动）
- **重点**：内存泄漏（24×7 引擎是第一优先级）、正确性 bug、竞态、错误处理、安全
- **基线提交**：`4f7f98f`（分支 `feat/ia-viewer-metrics-reconnect`）

---

## 1. 执行摘要

整体工程质量**高于同类业余/中型项目的平均水平**。架构清晰（protocol 单一事实源 + headless 引擎 + 瘦客户端），并且在最容易踩坑的两个地方做对了关键设计：

1. **引擎的生命周期清理契约是可靠的**：`BotInstance.cleanup()` 会先跑所有 `cleanupHooks`、清空共享的 `this.timers`，再 `bot.removeAllListeners()` + `bot.quit()`；每次重连都创建**全新** bot 对象。这意味着绝大多数"忘记 `removeListener`"在本项目里**并不构成跨重连泄漏**（旧 bot 连同监听器一起被 GC）。**真正的泄漏面因此很窄、很具体**——见第 4、6 节。
2. **桌面端子进程会被可靠回收**：`kill_engine` 挂在 `RunEvent::Exit`，并有引擎侧的**父进程 PID 看门狗**（~3s 自杀）兜底崩溃/强杀场景。

**没有发现 Critical 级（每次必现的崩溃/数据丢失）问题。** 但有 **21 个 Important** 问题值得在合并前处理，集中在三类：

- **少数真实内存泄漏**：最严重的是 `reconnect()` 里**未被追踪的 `setTimeout`** 可能"复活"已被显式停止/删除的 bot，产生永久泄漏的僵尸连接（[CORE-1](#core-1)）；其次是若干 per-bot 映射在 bot 删除/切换引擎时未清理（[CORE-2](#core-2)/[API-8](#api-8)、[UICORE-1](#uicore-1)、[UICORE-8](#uicore-8)）。
- **安全（在"单持令牌人=信任"模型下属中等，但可被绕过/放大）**：聊天安全过滤是**默认放行的黑名单**且可被命名空间/换行绕过（[API-2](#api-2)），且重生/地点命令**完全绕过**过滤（[API-1](#api-1)）；用户正则会带来 **ReDoS 冻结整个事件循环**（[API-3](#api-3)/[MODB-7](#modb-7)）；自定义 JS 是**无沙箱 RCE**，但已正确默认关闭（[MODB-2](#modb-2)）。
- **正确性 bug**：脚本引擎 `goto` 超时后寻路**不会被取消**、bot 在后台继续走（[MODA-3](#moda-3)）；前端若干一次性 fetch 缺少 unmount 守卫、`HoldButton` 在持握中卸载会泄漏定时器并让 bot 一直转（[UIFEAT-1](#uifeat-1)）。

---

## 2. 评分与统计

| 区域 | 文件范围 | Important | Minor | 小计 |
|---|---|---:|---:|---:|
| Engine 核心/生命周期 (CORE) | BotInstance / botManager / server / storage / utils | 2 | 6 | 8 |
| Engine 模块 A (MODA) | script_engine / mob_hunter / auto_farm / automine / recorder | 4 | 7 | 11 |
| Engine 模块 B + utils (MODB) | window_gui / inventory / message_monitor / custom_js / fishing … | 2 | 9 | 11 |
| Engine API/AI/安全 (API) | api/* / ai/observe / chatSafety / validateEnv | 5 | 7 | 12 |
| UI 基础设施 (UICORE) | lib/engine / store / components | 2 | 6 | 8 |
| UI 功能页 (UIFEAT) | features/bot/* / features/connect | 3 | 7 | 10 |
| 桌面 Rust/构建/协议 (DESK) | src-tauri / scripts / protocol | 3 | 8 | 11 |
| **合计** | | **21** | **50** | **71** |

> Critical：**0**。说明：没有"每次启动必现"的崩溃或数据丢失类问题；最高理论危害的自定义 JS RCE 已默认禁用。

按类别（去重后）：内存泄漏 ~12、正确性 bug ~18、竞态 ~9、错误处理 ~12、安全 ~11、性能 ~8、代码质量 ~6。

---

## 3. 前提：威胁模型与"泄漏模型"

阅读本报告前请先理解两个使审查结论"降级/升级"的前提：

- **威胁模型**：引擎采用"无账号 + 访问令牌"模型，假设**持令牌者即设备主人=可信**。因此很多"客户端可传入任意值"的问题在该模型下属中等而非致命。但报告仍标注它们，因为：令牌通过 stdout 明文打印且**不轮换**（[API-5](#api-5)）、默认可 `0.0.0.0` 绑定（[CORE-6](#core-6)）、传输未强制 WSS——一旦令牌泄漏，这些问题会把"控制 bot"放大为"在引擎主机执行命令/读取游戏账号密码"。
- **泄漏模型**：因为 `cleanup()` 调用 `bot.removeAllListeners()` 且每次重连都新建 bot，所以**"模块在 start 时 `bot.on(...)`、stop 时没 `removeListener`"通常不是跨重连泄漏**。真正会泄漏的只有三类：(a) **没被 `this.timers` 追踪、也没在 cleanupHook 里清的定时器**；(b) **进程级/模块级的全局状态**（如 viewer 的 `usedPorts`、botManager 的 per-id 映射）；(c) **用户自定义 JS 注册的、在脚本停止时不会被解绑的监听/定时器**。本报告的内存泄漏条目都落在这三类里。

---

## 4. 横切主题（最有价值的部分）

这些是跨多个文件重复出现的**模式**，建议作为一类统一修复，比逐条修更省事：

1. **未追踪的"裸 `setTimeout`"**（泄漏 + 竞态根因）
   - `reconnect()`、自动登录、`restoreModules`、respawn、`goToLocation` 的延迟回调（[CORE-1](#core-1)/[CORE-4](#core-4)）、mob_hunter 重生回调（[MODA-1](#moda-1)）都用了不存句柄、`cleanup()` 清不掉的 `setTimeout`。
   - 统一对策：所有生命周期定时器一律 `push` 到 `this.timers`（或专用字段），并在回调里用"connection epoch / bot 引用比对"防止陈旧回调命中新会话。

2. **per-entity 映射在删除/切换时不回收**（缓慢增长泄漏）
   - 引擎侧 `recentChat`/`recentOps` 在 `deleteBot` 时不清（[CORE-2](#core-2)/[API-8](#api-8)，两方独立印证）；前端 `removeBot` 只删 `logs`，漏了 `inventory`/`windows`/`scriptRuntime`/`monitorStats`/`moduleConfigs`（[UICORE-1](#uicore-1)），切换引擎也不重置（[UICORE-8](#uicore-8)）。
   - 统一对策：引擎 `deleteBot` 补 `dropLogs(id)`；前端加一个 `resetSession()` / 在 `removeBot` 与 `connect/disconnect` 里集中清理所有 per-bot 映射。

3. **长 `await` 链不在中途复检 `aborted`/`bot.entity`**（重连期偶发 null 崩溃）
   - 脚本引擎 stop 只置 `aborted`、farm/hunt 的在途 `goto`/`dig` 不被打断（[MODA-4](#moda-4)/[MODA-8](#moda-8)）；`Promise.race` 超时后败者分支的 `goto` 不取消（[MODA-3](#moda-3)）。
   - 统一对策：在每个重要 `await` 后 `if (ctx.aborted || !bot.entity) return;`；超时分支显式 `pathfinder.setGoal(null)` 并 `.catch(()=>{})` 吞掉败者 promise。

4. **客户端输入缺少 schema 校验就持久化/下发**（类型混淆 + DoS）
   - `addBot/updateBot` 不校验 `port`/长度（[API-6](#api-6)）；`scheduler:add`/`monitor:setRules`/`SCRIPT_SAVE` 原样存任意对象（[API-9](#api-9)）；坐标不挡 `NaN`（[API-11](#api-11)）；用户正则可 ReDoS（[API-3](#api-3)）。
   - 统一对策：每个写入/下发入口加最小 schema 校验（白名单字段 + 类型/范围 + 长度上限 + 索引边界）。

5. **聊天/命令安全是"默认放行黑名单"**（可绕过 + 有旁路）
   - 黑名单默认放行未知 `/` 命令、可被 `/minecraft:` 命名空间与 `\n` 换行绕过（[API-2](#api-2)）；重生/地点命令根本不过过滤（[API-1](#api-1)）。
   - 统一对策：改为**白名单**（只放行已知安全前缀），先 strip/拒绝 `\n\r` 与命名空间前缀，并让所有 client 派生文本的 `bot.chat` 都过同一道过滤。

6. **死代码/漂移给人虚假安全感**
   - `debouncedSave.js`、`validateEnv.js`、`passwordValidator.js`、`inventory.js` 均为**从未被调用**的死代码（[CORE-7](#core-7)、[API-4](#api-4)、[MODB-3](#modb-3)）；协议常量与引擎 `.js` 里硬编码事件名漂移（[DESK-6](#desk-6)）、默认端口两套（[DESK-7](#desk-7)）。
   - 统一对策：要么接线（如启动调用 `validateEnv()`、emit 改用 `ServerEvents` 常量），要么删除，避免"看起来有防护其实没跑"。

---

## 5. 优先修复清单（按性价比排序）

> 建议合并前完成 P0/P1。每条都给了对应详细发现的链接。

**P0 — 真实泄漏 / 全引擎可被冻结**
1. 追踪并可取消 `reconnect()` 等生命周期 `setTimeout`，并让 `init()` 在 `isExplicitlyQuitting`/已销毁时直接 bail → 杜绝僵尸 bot 连接泄漏。[CORE-1](#core-1)
2. 对来自客户端的正则做长度/复杂度限制或用 `re2`/超时执行 → 防止单条 `(a+)+$` 冻结整个事件循环、拖垮所有 bot。[API-3](#api-3)/[MODB-7](#modb-7)
3. `deleteBot` 补 `dropLogs(id)`；前端 `removeBot`/切换引擎清理全部 per-bot 映射。[CORE-2](#core-2)/[API-8](#api-8)、[UICORE-1](#uicore-1)、[UICORE-8](#uicore-8)

**P1 — 正确性 / 安全旁路 / 资源**
4. `goto` 超时后 `setGoal(null)` 取消寻路并吞掉败者 promise；裸 `goto` 加超时。[MODA-3](#moda-3)
5. 重生/地点命令存储或执行前过 `isChatBlocked()`；聊天过滤改白名单 + 处理换行/命名空间。[API-1](#api-1)、[API-2](#api-2)
6. `HoldButton` 加 unmount 清理（清 interval 并发停止指令）→ 防"卸载后 bot 一直转 + 定时器泄漏"。[UIFEAT-1](#uifeat-1)
7. 前端一次性 fetch（SettingsDialog/AiTab/CustomJsPanel/ScriptEditor）加 `cancelled` 守卫。[UICORE-5](#uicore-5)、[UIFEAT-9](#uifeat-9)
8. 加 `SIGINT`/`SIGTERM` 优雅关停（停所有 bot、关 HTTP/io server）。[CORE-3](#core-3)
9. `restart_app` 切换引擎前显式 `kill_engine` → 避免双引擎 + 端口竞争。[DESK-1](#desk-1)/[DESK-2](#desk-2)
10. `addBot/updateBot` 与 scheduler/monitor/script 写入加 schema 校验（含坐标 `NaN`、`port` 范围、`splice` 索引边界）。[API-6](#api-6)、[API-9](#api-9)、[API-11](#api-11)

**P2 — 加固 / 清理（可排期）**
11. `this.timers` 别在每次 toggle 时累积死句柄；viewer 端口池按实例释放并加回收兜底。[MODA-2](#moda-2)、[MODB-6](#modb-6)
12. 自定义 JS：在 `runCustomJs` 内复检 `ENGINE_ALLOW_JS`、去掉 `require`、给脚本提供受控的 `on/setInterval` 以便 stop 时统一解绑。[MODB-1](#modb-1)、[MODB-2](#modb-2)
13. 删除/接线死代码；统一协议事件名与默认端口常量。[CORE-7](#core-7)、[API-4](#api-4)、[MODB-3](#modb-3)、[DESK-6](#desk-6)、[DESK-7](#desk-7)
14. 令牌：constant-time 比较、给所有鉴权路由限流、stdout 打印改指纹、考虑轮换；`BOT_CONFIG` 不回传明文密码。[CORE-6](#core-6)、[API-5](#api-5)、[API-10](#api-10)
15. 构建脚本：`make-engine-bundle.mjs` 把"`node_modules` 缺失"视为硬错误，产物完整性自检。[DESK-8](#desk-8)/[DESK-9](#desk-9)

---

## 6. 内存泄漏专项（用户第一优先级）

> 结论：**没有"运行即爆"的泄漏**；最严重的是条件触发的僵尸连接泄漏（CORE-1）。下表是全部真实泄漏面（已剔除被 `cleanup()` 兜住的"伪泄漏"）。

| 编号 | 位置 | 泄漏物 | 触发条件 | 严重度 |
|---|---|---|---|---|
| [CORE-1](#core-1) | `BotInstance.js:527` 等 | 整条 mineflayer 连接 + 模块定时器（僵尸 bot） | 在 1s 延迟窗口内 stop/delete 后被定时器复活；实例已脱离 manager 永不可停 | **Important（最严重）** |
| [CORE-2](#core-2)/[API-8](#api-8) | `botManager.ts:261` | `recentChat`/`recentOps` per-id 条目 | 每次 `deleteBot` 残留（两方独立印证） | Important |
| [UICORE-1](#uicore-1) | `useStore.ts:198` | `inventory`/`windows`/`scriptRuntime`/`monitorStats`/`moduleConfigs` | 每次 `removeBot` 只删 logs | Important |
| [UICORE-8](#uicore-8) | `engine.ts:172/281` | 上述 per-bot 映射 | 切换引擎不重置 | Minor |
| [MODA-2](#moda-2) | `mob_hunter.js:647`、`auto_farm.js:272` | `this.timers` 里的**已失效**句柄 | 长连接中反复 toggle | Important |
| [MODA-1](#moda-1) | `mob_hunter.js:542` | 重生 `setTimeout`（未追踪） | 死亡→重生→toggle/重连窗口 | Important |
| [MODB-1](#modb-1) | `custom_js.js:34/93` | 用户脚本注册的 `bot.on`/`setInterval` | 启用 JS 后脚本停止/重跑 | Important |
| [MODB-6](#modb-6) | `bot_viewer.js:10` | 进程级 `usedPorts`（53 个端口耗尽） | 多 bot 频繁开关视角 | Minor |
| [UIFEAT-1](#uifeat-1) | `Joystick.tsx:95` | `setInterval`（且 bot 持续转动） | 持握按钮时组件卸载 | Important |
| [MODA-10](#moda-10) | `recorder.js:24` | `steps` 数组无上限 | 开录后忘记停 | Minor |
| 上游备注 | `bot_viewer.js` → prismarine-viewer | `io`(socket.io) 心跳定时器 | 视角 stop/重连（`close()` 未调 `io.close()`） | Minor（含上游因素） |

**判定为"非泄漏"（已验证，供安心）**：各模块 start 时 `bot.on(...)` 而 stop 时未 `removeListener` 的写法，因 `cleanup()` 的 `removeAllListeners()` + 每次重连新建 bot 而**不会跨重连累积**；`message_monitor` 用聚合计数而非保留原文、`byKey` 截断 30；store 的 `logs`(500)/`chatHistory`(30) 都有上限；`fishing.js` 在 `finally` 里清定时器堪称范本。

---

## 7. 安全专项

> 在"单持令牌人=信任"模型下，多数条目属中等；但令牌明文打印且不轮换、默认可 `0.0.0.0` 绑定、传输未强制加密，会放大其影响。

- **聊天/命令注入**：黑名单**默认放行**未知 `/` 命令，且 `/minecraft:gamemode`、`hello\n/op me` 可绕过（[API-2](#api-2)）；重生命令、地点 warp 命令**完全不过过滤**直接 `bot.chat()`（[API-1](#api-1)）。建议改白名单 + 处理换行/命名空间 + 所有 client 文本统一过滤。
- **ReDoS（可冻结整个引擎）**：`monitor:setRules`/`monitor:test` 把客户端 pattern 直接 `new RegExp` 并对每条聊天 `exec`，灾难性回溯可卡死事件循环、影响所有 bot（[API-3](#api-3)/[MODB-7](#modb-7)）。
- **自定义 JS = 无沙箱 RCE**：`new AsyncFunction(..., "require", code)` 注入真实 `require`，可读 `bots.json` 明文密码、跑系统命令（[MODB-2](#modb-2)）。**已正确默认关闭**（`ENGINE_ALLOW_JS=1` 才开，且有醒目警告）——属"已知可接受风险"，但建议在 `runCustomJs` 内再复检开关、去掉 `require`。
- **令牌处理**：`!==` 非常量时间比较、仅 `/api/connection-info` 限流（[CORE-6](#core-6)）；令牌 stdout 明文且不轮换（[API-5](#api-5)）；`BOT_CONFIG` 回传游戏账号明文密码（[API-10](#api-10)）。
- **输入校验缺失**：`port`/坐标/`settings` 不校验即持久化与下发（[API-6](#api-6)、[API-9](#api-9)、[API-11](#api-11)）；客户端对象浅合并入引擎状态（[API-7](#api-7)）。
- **死的安全代码**：`validateEnv()`（强制 HTTPS/密钥长度）**从未被调用**，且校验的是引擎根本不用的 `SESSION_SECRET`（[API-4](#api-4)）。
- **桌面安全面（正向）**：引擎仅 `127.0.0.1` 绑定、每次启动随机 UUID 令牌、Tauri 能力集最小（无 shell/fs 插件）；但 `default.json` 描述写了"shell open"而实际未授权，属文档/范围不一致（[DESK-10](#desk-10)）。

---

## 8. 详细发现（按区域；保留子代理编号以便追溯）

### 8.1 Engine 核心 / 生命周期（CORE）

<a id="core-1"></a>**[CORE-1] reconnect/spawn 路径的未追踪 `setTimeout` 可复活已停止/删除的 bot** · Important · Memory Leak/Race · `packages/engine/src/BotInstance.js:527`（另 `:149/:204/:342/:605`） · 置信 High
`reconnect()` 执行 `this.cleanup(); setTimeout(() => this.init(), 1000)`，该定时器既不在 `this.timers` 也不在 `this.reconnectTimer`，故随后的 `stop()`（只跑 `cleanup()`）无法取消它。1s 后 `init()` 运行并把 `isExplicitlyQuitting` 重置为 false（`:86`，已复核）——于是被显式停止/删除的 bot 重新上线。经 `deleteBot → stop → bots.delete(id)` 后，孤立实例的定时器再调 `init()`，建立一个**已不在 manager `bots` 表、永远无法再停止**的僵尸连接（24×7 进程里的永久连接 + interval 泄漏）。自动登录/`restoreModules`/respawn/`goToLocation` 同模式，快速断重连时可命中新会话（如模块重复激活）。
**修复**：所有生命周期 `setTimeout` 存句柄并入 `this.timers`（reconnect 复用 `this.reconnectTimer`）；`init()` 在 `isExplicitlyQuitting` 为真时直接 return；`stop()/deleteBot` 置"destroyed"标志供延迟回调检查。

<a id="core-3"></a>**[CORE-3] 无优雅关停：SIGINT/SIGTERM 与看门狗 `process.exit` 跳过 bot 清理** · Important · Error Handling · `packages/engine/src/bin/serve.ts:7-27` · 置信 High
只注册了 `unhandledRejection`/`uncaughtException` 和父 PID 看门狗（直接 `process.exit(0)`），**没有任何 SIGINT/SIGTERM/beforeExit**。Ctrl+C、`docker stop`、宿主退出时不会 `stop()` 任何 bot：mineflayer TCP、`bot_viewer` 的 HTTP/io server、所有模块 interval 都被丢给 OS。配置写是同步的所以不丢，但连接不被优雅关闭、服务端会留"幽灵会话"。
**修复**：`process.on("SIGINT"/"SIGTERM")` 里遍历 `stop()` 所有实例、关 HTTP/io server，再 `exit(0)`；看门狗同样先清理。

<a id="core-2"></a>**[CORE-2] `deleteBot` 不回收 per-bot 日志缓冲**（= [API-8](#api-8)，两方独立印证）· Minor · Memory Leak · `packages/engine/src/botManager.ts:261-277` · 置信 High
`recentChat`/`recentOps`（各截断 40 行）在 `updateBot` 重连分支会 `dropLogs(id)`，但 `deleteBot` 不会（已复核 261-277 无该调用）。每个被增后删的 bot 永久残留两个数组键。**修复**：`deleteBot` 在 `bots.delete(id)` 后补 `this.dropLogs(id)`。

<a id="core-4"></a>**[CORE-4] `restoreModules` 延迟激活在重叠重连时可重复激活模块** · Minor · Race · `BotInstance.js:203-232` · 置信 Medium
3.5s `RESTORE_DELAY`（未追踪定时器，见 CORE-1）只判 `!this.bot||!this.bot.entity`。窗口内断重连时陈旧定时器会对**新**连接再跑一遍 toggle*，叠加状态。自动登录定时器同理。**修复**：调度时捕获当前 bot 引用/epoch，回调里比对一致才执行，并入 `this.timers`。

<a id="core-5"></a>**[CORE-5] `removeAllListeners()` 不覆盖 `bot._client`** · Minor · Memory Leak · `BotInstance.js:105-110/:502` · 置信 Medium
`cleanup()` 的 `bot.removeAllListeners()` 不清底层 `bot._client`（独立 EventEmitter）上 `init()` 注册的 `error` 监听。实践中因每次新建 bot+`_client` 且旧的被解引用 GC，所以**当前不累积**；仅当有人复用同一 `_client` 才成真泄漏。**修复**：存句柄并在 cleanup `bot._client?.removeListener('error', fn)`。低优先。

<a id="core-6"></a>**[CORE-6] 令牌非常量时间比较 + 鉴权端点限流不均** · Minor · Security · `server.ts:54/:318-324`，限流仅 `:65-72` · 置信 Medium
HTTP `requireToken` 与 socket 握手都用 `!==` 明文比较（非 timing-safe）；`authLimiter`(30/min) 只挂在 `/api/connection-info`，其余鉴权路由与 socket 握手无限流，默认 `0.0.0.0` 绑定（`:338`）扩大暴露。48-hex 令牌使暴破风险小，但仍建议 `crypto.timingSafeEqual` + 全路由限流 + 默认 `127.0.0.1`。

<a id="core-7"></a>**[CORE-7] `debouncedSave.js` 是死代码，其崩溃安全/`forceFlush` 从未接线** · Minor · Code Quality · 整个文件 · 置信 High
全 `src` 无任何 import（已 grep）；所有持久化走 `storage.ts` 同步原子写。若启用还有缺陷：`save()` 每次重置防抖定时器，持续活动下 flush 被无限饿死，而无人调 `forceFlush`。**修复**：删除，或加 max-wait 下限并接入关停钩子（见 CORE-3）。

<a id="core-8"></a>**[CORE-8] `updateStatus` 每 2s/bot `JSON.stringify(modules)` 做变更检测** · Minor · Performance · `BotInstance.js:373` · 置信 Medium
状态 interval 每 2s 对完整 `modules`（含 `combatConfig`/`schedules`）序列化做去重签名，多 bot 时是持续可避免的 CPU/GC 开销。**修复**：用已提取的少量标量字段构造签名，或仅在模块 toggle 时重算。

### 8.2 Engine 模块 A（MODA）

<a id="moda-1"></a>**[MODA-1] mob_hunter 重生 `setTimeout` 未追踪、stop 不取消** · Important · Memory Leak · `mob_hunter.js:542` · 置信 High
`handleRespawn()` 的 2s `setTimeout` 句柄不存、不入 `timers`、不清。toggle off/重连命中该窗口时回调仍触发；重连中可对已拆除/`null` 的 bot 执行。**修复**：存句柄入 `timers`，在 toggle(false) 与 cleanup 里清，回调内加 `!bot.entity` 守卫。

<a id="moda-2"></a>**[MODA-2] `this.timers` 在每次 in-session toggle 累积失效句柄（mob_hunter & auto_farm）** · Important · Memory Leak · `mob_hunter.js:647-648`、`auto_farm.js:272` · 置信 High
`this.timers` 只在 `cleanup()` 清空。每次 `toggle(true)` 都 push 新句柄，旧 interval 虽被 clear（无活定时器泄漏），但**已失效的句柄永久留在数组里**。长连接里反复 toggle → 数组无界增长。automine 作者已显式规避此模式（见 `automine.js:44` 注释）。**修复**：toggle 时先从 `timers` 中移除旧句柄再 push，或只在模块 init 时注册一次槽位。

<a id="moda-3"></a>**[MODA-3] `goto` 的 `Promise.race` 败者分支：超时后寻路仍在后台运行** · Important · Bug · `script_engine.js:341-346`（`goto_location` 354-358）· 置信 High
`Promise.race([pathfinder.goto(goal), sleep(timeout).then(()=>{throw '寻路超时'})])` 中超时获胜时**不取消**底层 `goto`——bot 在后台继续走向目标，孤立 goto 之后会 unhandled reject，"超时"的 goto 可在后续步骤继续驱动 bot。裸 `goto`（335/427）无超时，单个不可达目标会无限挂起该步。**修复**：超时分支 `pathfinder.setGoal(null)` 并给败者 `.catch(()=>{})`；裸 goto 套同一超时助手。

<a id="moda-4"></a>**[MODA-4] `stopScript()` 只置 abort 标志，在途 `await`（dig/goto/clickWindow）继续作用于可能已销毁的 bot** · Important · Race · `script_engine.js:997-1010`（abort 检查在 316-317/711）· 置信 Medium
`aborted` 仅在步骤间与显式轮询里复检；若 stop 由断连触发，已 resolve 的 await 下一行可能触碰 `null` bot。爆炸半径为单个在途动作，但 24×7 重连下表现为脚本引擎偶发 null。**修复**：`executeAction` 每个重要 await 后复检 `if (ctx.aborted||!bot.entity) return;`；长 await 与 abort 信号 race。

<a id="moda-5"></a>**[MODA-5] 触发器在 `checkTriggers` 与 `runScript` 置位之间存在理论窗口** · Minor · Race · `script_engine.js:883-897/844-855` · 置信 Medium
`runScript` 在首个 await 前同步置 `_runningScript`（854），实际已防住交错；残留风险在 `runSteps`/`startScript` 与触发 interval 的不同时序。**修复**：把"占用单运行槽"集中为一个同步 helper 供所有入口先调。

<a id="moda-6"></a>**[MODA-6] `evalMath`/`set_var "="` 用 `Function(...)` 动态求值** · Minor · Security · `script_engine.js:90-96`（用于 615-616）· 置信 High
受严格正则 `^[\d\s+\-*/()%.]+$` 限制，正常路径无法触达任意代码（正则在插值后应用，正确）；但 `Function` eval 在 24×7 引擎是隐患，且失败被静默吞为原字符串可污染下游数值比较。**修复**：换成显式算术解析器（无代码生成），或至少记录解析失败而非静默返回原串。

<a id="moda-7"></a>**[MODA-7] auto_farm 成熟判定用严格 `age === matureAge`，且 `scanFarmland` 用 `count:999`** · Minor · Bug · `auto_farm.js:46/:296` · 置信 Medium
当 `getProperties()` 不可用、`metadata` 为 `undefined` 时，`undefined === 7` 恒 false → 静默不收割（headless 难诊断）；`count:999` 是近无界分配。**修复**：用 `age >= matureAge`，`undefined` 视为"未知→跳过并一次性告警"；`scanFarmland` count 设上限（如 512）。

<a id="moda-8"></a>**[MODA-8] `farmCycle` 长 await 链在 stop 中途不复检** · Minor · Error Handling · `auto_farm.js:187-228`（cleanup 316-323）· 置信 Medium
在 `harvestCrop` 的 `goto`/`dig` 在途时 toggle off/cleanup，在途操作不被打断，resolve 后再触碰 `bot.*`；重连触发的 cleanup 下 `bot` 可能 `null`。比 MODA-4 轻（有 try/catch + 20s 间隔）。**修复**：各 await 后复检 `active`/`bot.entity`。

<a id="moda-9"></a>**[MODA-9] `equip_best_weapon` 的 `getMcData()` 未守卫（已被 catch 兜住）** · Minor · Error Handling · `script_engine.js:481-489` · 置信 Low
`mc.items[...]` 若 `mc` 为 null 会抛，但落在按名排序的 catch 里；唯一问题是 catch 静默，持续失败不可见。**修复**：失败记一次日志或先 null-check。

<a id="moda-10"></a>**[MODA-10] `recorder.steps` 录制期间无上限** · Minor · Memory Leak · `recorder.js:24-31/50-69` · 置信 Medium
无 `MAX_STEPS`，用户开录后忘停会随每个动作无界增长（下次 `start()` 才丢弃）。无 `bot.on`/定时器，其余干净。**修复**：加 `MAX_STEPS` 上限告警停止 + 静默 N 分钟自动停。

<a id="moda-11"></a>**[MODA-11] `huntCycle` 完全静默吞错** · Minor · Error Handling · `mob_hunter.js:499-503` · 置信 Low
`catch(err){}` 全静默；持续抛错（如 pathfinder 反复 reject）会每 350ms 空转、运维零信号。控制状态清理本身 OK。**修复**：对捕获错误限频记录（每 N 秒/变化时）。

<a id="moda-12"></a>**[MODA-12] `mining/humanizer.js` 干净，无问题** · — · `mining/humanizer.js:1-31` · 置信 High
纯无状态函数，无 bot 引用/定时器/监听/保留态——对高频调用的助手而言正合适。按要求显式记录"已审无问题"。

### 8.3 Engine 模块 B + utils（MODB）

<a id="modb-1"></a>**[MODB-1] 自定义 JS：用户脚本注册的监听/定时器无追踪、不清理** · Important · Memory Leak · `custom_js.js:34/85/93-105` · 置信 High
沙箱把原始 `bot` 交给用户代码却无 scoped 注册表。脚本可 `bot.on('chat',…)`/`setInterval(…)`；`stopCustomJs()` 只置 `cancelled` 并清寻路目标，**不解绑任何脚本注册物**。`cancelled` 是协作式的——忽略 `api.stopped` 的脚本停不下来。24×7 反复跑脚本会累积，只有整体断连才回收。**修复**：每次运行隔离注册表，经 `api` 提供包装的 `on/once/setInterval/setTimeout` 记录句柄，stop/`.finally` 里统一移除。

<a id="modb-2"></a>**[MODB-2] 自定义 JS：`new AsyncFunction` 携真实 `require` = 无沙箱 RCE** · Important · Security · `custom_js.js:7/85/95` · 置信 High（已复核 `:85` 与 `:95`）
可 `require('fs'/'child_process')` 读 `bots.json` 明文密码/跑 shell。**已正确默认关闭**（`ENGINE_ALLOW_JS=1`，`moduleHandlers.ts:188` 已复核，带 RCE 警告）——属已知可接受风险。残留：(a) 开关只在 `js:run` socket handler 查，其他内部调用者会绕过；(b) 传 `require` 多余。**修复**：在 `runCustomJs` 内复检开关；去掉 `require`（或换白名单 shim）；如可能让非完全可信者开启，考虑 `node:vm` 受控上下文。

<a id="modb-3"></a>**[MODB-3] `inventory.js` 是死/遗留代码，却仍装两个活监听并在每次 setSlot 干活** · Minor · Performance · `inventory.js:44-48/64-80` · 置信 High
它 emit 的 `window_data` **不在协议、前端无人消费**（已被 `window_gui.js` 取代），却仍 `bot.on('windowOpen'/'setSlot')` 并对每个 `setSlot` 全量 NBT 序列化。RPG 菜单刷 `set_slot` 时持续白耗 CPU（非跨重连泄漏）。**修复**：从 `MODULE_NAMES`（`BotInstance.js:126-131`）移除并删文件。

<a id="modb-4"></a>**[MODB-4] window_gui 点击/探索：window 可能在 await 中途被关闭后仍被操作** · Minor · Race · `window_gui.js:86-94/140-155` · 置信 Medium
`clickWindowSlot`/`exploreMenuItem` 在 150ms/500ms sleep 与 clickPath 循环中，服务器可关窗或断连（`bot` 置 null），随后 `serialize(bot.currentWindow)` 会抛。**修复**：每次 await 后复检 `bot` 与 `currentWindow` 再序列化/点击；每步 clickWindow 套 try/catch。

<a id="modb-5"></a>**[MODB-5] fishing 硬编码鱼竿最大耐久(64) 错误，破坏 Unbreaking/命名竿** · Minor · Bug · `fishing.js:42-43` · 置信 Medium
原版鱼竿耐久 65（64 次），常量已差一；忽略实际 maxDurability 与 Unbreaking → 高耐久/自定义竿被误判低耐久换走。**修复**：从 item 数据取 max（`itemsByName[...].maxDurability ?? rod.maxDurability ?? 64`），用相对阈值（如 `>= max-2`）。

<a id="modb-6"></a>**[MODB-6] bot_viewer 模块级 `usedPorts` 全进程共享，硬失败时端口不释放** · Minor · Memory Leak · `bot_viewer.js:10/39/59/84` · 置信 Medium
53 个端口的全局 Set 被所有实例共享，仅靠 2s 后 `delete` 回收。多 bot 高频开关或经异常路径拆除时端口泄漏，耗尽后 `startViewer` 永久抛"视角启动失败"；`blockClicked` 监听也无显式清理。**修复**：stop 时立即 `delete`；按实例跟踪端口并在 cleanup 必释；池满时回收已死 viewer 的端口。

<a id="modb-7"></a>**[MODB-7] message_monitor 编译用户正则——ReDoS/灾难性回溯**（= [API-3](#api-3)）· Minor · Security · `message_monitor.js:40-49/92-113` · 置信 Medium
规则来自 UI，`new RegExp(pattern,"g")` 对每条聊天 exec；`(a+)+$` 类 pattern 配可控聊天可卡死整个事件循环。500 次迭代守卫只限匹配数、不限单次 exec 成本。**修复**：限制 pattern 长度/复杂度，或用 `re2`/超时执行；至少限长并文档化信任假设。

<a id="modb-8"></a>**[MODB-8] player_inventory `useSlot` 用 `totalOf` 差值判定放置成功，可误判** · Minor · Bug · `player_inventory.js:184-203` · 置信 Low
800ms 内若有同名物品的无关数量变化，差值会给出假成功/失败信号（仅影响日志/偶尔漏 air 回退）。**修复**：尽量比较源 slot 前后 count，或弱化日志措辞。

<a id="modb-9"></a>**[MODB-9] scoreboard 数值提取取标签里第一个数字，可能取到等级而非数值** · Minor · Bug · `scoreboard.js:126-140` · 置信 Low
`Lv.5 金币 999` 会取 `5`；只看 `name` 忽略 `value`。**修复**：优先用结构化 `value`，文本解析取最后/最大或关键词相邻数字，同时暴露 `value` 与 `raw`。

<a id="modb-10"></a>**[MODB-10] NBT Lore 形状假设不一致，畸形 NBT 可让整窗快照失败** · Minor · Error Handling · `window_gui.js:47-50`（对比 `player_inventory.js:54-55`/`inventory.js:25`）· 置信 Low
`serialize` 的 `.map` 无 try/catch，单个畸形 item NBT 抛出会废掉整个 `getWindow`。**修复**：每 slot 序列化套 try/catch（失败返回最小 `{slot,name:null}`）；统一 Lore 守卫。

<a id="modb-11"></a>**[MODB-11] scoreboard/player_inventory/message_monitor 的周期 interval 无视"是否开启"永久运行** · Minor · Performance · `scoreboard.js:115`/`player_inventory.js:228`/`message_monitor.js:161` · 置信 Medium
不可 toggle，无 start/stop：即使无人看 UI，仍每 10s 全量解析背包 NBT、每 5s 走计分板、每 1.5s 查脏标志，整个 24×7 生命周期持续，随 bot 数线性增长（断连会清，非泄漏）。**修复**：按"是否有客户端在看该 bot"（引擎已有 room）或持久化开关门控重活。

### 8.4 Engine API / AI / 安全（API）

<a id="api-1"></a>**[API-1] chatSafety 被重生命令与地点 warp 命令完全绕过** · Important · Security · `moduleHandlers.ts:341-347`（另 `:232-243/:260-270`），执行于 `BotInstance.js:344/:598` · 置信 High（已复核 `:341-347` 存储未过滤）
`behavior:setRespawnCmd` 与 `location:save`/`location:set-reach` 把任意客户端字符串存入设置/地点，之后直接 `bot.chat()` **不过 `isChatBlocked()`**。客户端可设 `respawnCommand = /op X` 在下次死亡时自动触发，完全击穿唯一的命令注入防线。**修复**：在存储点（三个 handler）与/或 `bot.chat()` 前过 `isChatBlocked()`；集中化所有 client 文本的 chat 过滤。

<a id="api-2"></a>**[API-2] `isChatBlocked` 黑名单可被轻易绕过（未知 `/` 命令默认放行、无换行处理）** · Important · Security · `chatSafety.js:18-27` · 置信 High（已复核全文件）
(1) 黑名单 + 默认放行：既不在 `ALLOWED_PREFIXES` 也不在 `BLOCKED_COMMANDS` 的 `/` 命令返回 false（放行）——`/minecraft:gamemode`、`/lp user X parent set admin`、`/pex` 等直接通过。(2) 无换行检查：只看整串前缀，`hello\n/op me` 以 `hello` 开头（放行）却可投递第二行命令。**修复**：`/` 命令改白名单（只放已知安全前缀，其余默认拒绝）；先 strip/拒绝 `\n\r` 与控制字符；归一化去掉前导命名空间 `/[a-z_]+:` 再做二次黑名单。

<a id="api-3"></a>**[API-3] 从客户端输入编译的无界、无超时 `RegExp`（ReDoS）**（= [MODB-7](#modb-7)）· Important · Security · `message_monitor.js:44/198` ← `moduleHandlers.ts:351-360` · 置信 High
`monitor:setRules`/`monitor:test` 把 pattern 直送 `new RegExp` 并对每条聊天 `while(re.exec())`。灾难性回溯 + 可控聊天可钉死事件循环，**冻结该引擎管理的所有 bot**。Node 正则无超时；`guard>500` 只限匹配数。**修复**：限长/拒危险构造，或用 `re2`/worker+超时；至少限长并明确单 owner 信任模型。

<a id="api-4"></a>**[API-4] `validateEnv`/`passwordValidator` 安全工具是死代码，从未被调用** · Minor · Security · `validateEnv.js:6/66`、`passwordValidator.js:6/45` · 置信 High
grep 全引擎无调用：启动从不跑 `validateEnv()`，其"无 HTTPS 拒启动、强制 `SESSION_SECRET`"等防护从不生效，给人虚假安全感；且它校验的是引擎根本不用的 `SESSION_SECRET`（引擎用 `ENGINE_TOKEN`）。**修复**：接入 `serve.ts` 启动（并改校验 `ENGINE_TOKEN` 强度），或删除二者，别留休眠面。

<a id="api-5"></a>**[API-5] 访问令牌每次启动明文打印到 stdout** · Minor · Security · `bin/serve.ts:34`（连接串 `:37` 经 `connectionInfo.ts:19` 内嵌令牌）· 置信 Medium
桌面本地配对场景属预期 UX，但容器/宿主出货日志（`docker logs`/journald/CI）会收录令牌；令牌不轮换（持久化于 `data/token`），一次日志泄漏=永久凭据泄漏。**修复**：明文打印门控在交互/桌面标志后，或只打印指纹 + 指向 `/api/connection-info`；支持轮换。

<a id="api-6"></a>**[API-6] bot 配置输入不校验/不限长——类型混淆 + 无界字段持久化** · Important · Bug · `botManager.ts:238-259/279-320` ← `handlers.ts:22/79` · 置信 High
`addBot/updateBot` 只判 `username`/`host` 真值。`port` 无类型/范围校验（`"25565; rm"`/`99999`/对象都会被存并交给 mineflayer），`username/host/note/loginPassword` 无长度上限，`settings` 被客户端对象浅合并直接入持久化与运行实例。坏类型会在连接路径/模块 handler 深处抛错；无界 `note/host` 撑大 `bots.json` 与每次广播快照。**修复**：`port` 限 1–65535 整数；字符串限长；`version` 匹配已知模式；`settings` 按白名单键 + 类型校验后再合并。

<a id="api-7"></a>**[API-7] 客户端配置对象的浅合并存在原型污染倾向** · Minor · Security · `moduleHandlers.ts:73/76`、`botManager.ts:298` · 置信 Medium
`{...inst.combatConfig, ...config}` 等把原始客户端对象 spread 进引擎状态。原生 spread 不复制 `__proto__` 数据键（故非经典 `Object.prototype` 污染），但未校验的键/值流入模块逻辑且被持久化重读。**修复**：改逐字段拷贝（按已知键 + 类型检查）；绝不持久化原始客户端对象。

<a id="api-8"></a>**[API-8] stopped bot 的 per-bot 日志/观测缓冲与实例映射不回收**（= [CORE-2](#core-2)）· Minor · Memory Leak · `botManager.ts:37-43/50-53` · 置信 Medium
`deleteBot` 调了 `.stop()` 但不调 `dropLogs(id)`，删除 bot 的 `recentChat`/`recentOps` 键在进程生命周期内长存（缓冲本身有界，属陈旧键缓增）。**修复**：`deleteBot` 内补 `dropLogs(id)`。

<a id="api-9"></a>**[API-9] scheduler/monitor/script 写入原样持久化任意客户端对象，无形状校验** · Important · Bug · `moduleHandlers.ts:391-397/:351`、`scriptHandlers.ts:29-38` · 置信 High
`scheduler:add` 原样 push `args.schedule`；`scheduler:remove` 的 `Number(args.index)` 不挡越界/`NaN`（`splice(NaN,1)` 静默无效，负索引从尾删错条目）；`SCRIPT_SAVE` 只验 `steps` 是数组、不验步内容就 `preloadScripts` 下发到所有在线实例。垃圾入盘并在每次重启重放。**修复**：按显式 schema 校验每个对象；`remove` 索引限 `[0,length)`；不合规 `fail(...)`；考虑持久化 schema 版本化。

<a id="api-10"></a>**[API-10] 敏感配置（登录密码）回传给任意已鉴权客户端** · Minor · Security · `handlers.ts:85-99`（`BOT_CONFIG` 返回 `loginPassword`）· 置信 Medium
明文回传游戏账号密码到请求方。单 owner 模型下"按设计"，但意味着持令牌者可经网络取回密码，且明文 WS 传输（除非外部强制 WSS，而 `validateEnv` 本应强制却从不运行——API-4）。把令牌泄漏从"控制 bot"放大为"窃取游戏登录凭据"。**修复**：`BOT_CONFIG` 不回传 `loginPassword`（改返回 `hasLoginPassword` 布尔）；如需回填编辑表单则显式 reveal + 确保加密传输。

<a id="api-11"></a>**[API-11] `move:*`/坐标 handler 接受未校验数值（NaN 传播）** · Minor · Bug · `moduleHandlers.ts:278-281/218-228/311-318`、`handlers.ts:64-77` · 置信 Medium
坐标 `Number(args.x)` 无 `isNaN` 守卫即交寻路；`BOT_GOTO` 干脆不转型直接 `inst.move(x,y,z)`。脚本引擎的 `goto` 已有 `isNaN` 守卫（`script_engine.js:339`），说明该模式只是 API handler 漏了。**修复**：在 `BOT_GOTO`/`move:goto`/hunt-area 校验有限数，`NaN` 时 `fail("坐标无效")`。

<a id="api-12"></a>**[API-12] 控制面测试恰好缺失高危路径覆盖** · Minor · Code Quality · `test/control-plane.cjs` · 置信 High
现有 e2e 测试断言真实行为（鉴权收/拒、增/重/删、快照、模块 toggle、未知模块错误、`/health`、401/200）——很好。但无注入/校验面覆盖：未测 `BOT_CHAT` 拦截黑名单、未测重生/地点命令过滤（实际未过滤—API-1）、未测非法 `port`/坐标类型、未测无 `ENGINE_ALLOW_JS` 时 `js:run` 仍禁、未测 observe 形状。`emitAck` 超时 resolve `null` 且多处 `check` 把 `null` 当假，丢失的 ack 会伪装成断言结果。**修复**：补上述用例；让 `emitAck` 超时/拒绝可区分。

### 8.5 UI 基础设施（UICORE）

<a id="uicore-1"></a>**[UICORE-1] per-bot store 映射在删除 bot 时不修剪** · Important · Memory Leak · `useStore.ts:198-205`（映射定义 46-53）· 置信 High（已复核 `removeBot` 只删 `logs`）
`removeBot` 只删 `logs[id]`，漏了 `inventory`/`windows`/`scriptRuntime`/`monitorStats`/`moduleConfigs`。多小时会话里增删/重建 bot 会累积永不可达的陈旧条目；`moduleConfigs` 键 `${botId}:${module}` 尤甚。注意 `inventory`/`windows` 键为 `_bid||user`（`engine.ts:217-231`），清理需兼顾两种键形。**修复**：`removeBot` 一并剔除该 id（及 `${id}:*`）；按 `_bid` 键修剪；`setBots` 时按新名册回收无效用户名。

<a id="uicore-2"></a>**[UICORE-2] 手动 `disconnect()` 与 socket.io 自动重连竞态；自动连接不观察取消标志** · Important · Race · `engine.ts:281-288/177-197` · 置信 Medium
`disconnect()` 先 `removeAllListeners()` 再 `disconnect()`（顺序正确）；但 socket 以 `reconnection:true, reconnectionAttempts:Infinity` 创建。危险窗口在 `tryTauriAutoConnect()`（`engine.ts:99-123`）：它健康轮询最多 ~20s 后**无条件** `connect()`，且**不看** App 的 `cancelled` 标志。用户在该 20s 内点断开/卸载组件，在途自动连接仍会 `connect()`，复活用户已拆除的 socket。**修复**：`tryTauriAutoConnect` 接受/检查取消信号（`AbortSignal`/`()=>boolean`），最终 `connect()` 前 bail；另设模块级"已手动断开"标志，`disconnect()` 置、`connect()` 清。

<a id="uicore-3"></a>**[UICORE-3] `emitAck` 超时后丢弃迟到响应；非幂等命令可致用户误重试** · Minor · Error Handling · `engine.ts:290-303` · 置信 Medium
用 socket.io `.timeout(8000)`（其自身清 ack handler，**非泄漏**）。语义问题：引擎 8s 后才回的响应被静默丢弃；对 `addBot/deleteBot/saveScript` 等非幂等命令，UI 报失败而引擎实已执行，用户重试致重复。**修复**：dev 下记录迟到 ack；非幂等命令超时提示"可能已成功，请刷新"而非直接失败。

<a id="uicore-4"></a>**[UICORE-4] 共享 `Modal` 无 Esc 关闭、无 focus trap/scroll lock** · Minor · Code Quality · `Modal.tsx:28-55` · 置信 High
仅 backdrop/X 关闭。无 `keydown` Esc、无聚焦陷阱、无 body 滚动锁。无 `useEffect` 故也无泄漏，但缺标准模态行为（被 SettingsDialog/AddBotDialog/删除确认复用）。**修复**：`open` 时注册 Esc `keydown` 监听（cleanup 移除），可选切换 `body.overflow`，deps `[open,onClose]`。

<a id="uicore-5"></a>**[UICORE-5] `SettingsDialog` 开启时 fetch 可在卸载/关闭后 setState** · Minor · Bug · `SettingsDialog.tsx:33-38`（`EngineSourceSection` 137-144 同）· 置信 Medium
`fetchConnectionInfo().then(setInfo)` 无 cleanup/取消。慢/不可达引擎下，关闭后 resolve 会对无关组件 setState，且上次 open 的陈旧响应可能填充本次。**修复**：`let alive=true; ...then(r=>{if(alive)setInfo(r)}); return ()=>{alive=false}`，`EngineSourceSection` 挂载 effect 同样处理。

<a id="uicore-6"></a>**[UICORE-6] `labelKey` 可把不同计分板行折叠为同键，致钉选指标错配** · Minor · Bug · `headerMetrics.ts:61-65`（消费于 110-122/89-102）· 置信 Medium
去掉首个数字成标签，文本相同的两行产生同键；`computeMetrics` 只取首现、`detectFromScoreboard` 按键去重，碰撞的第二行被静默丢弃，钉选指标可能绑错行。纯数字行产生空 `labelKey` 已被正确跳过。**修复**：去重时对碰撞键消歧（附索引/行位），或在配置 UI 对同 `labelKey` 告警。

<a id="uicore-7"></a>**[UICORE-7] `McText` 每次渲染重解析每行并订阅整个 theme** · Minor · Performance · `McText.tsx:91-115` · 置信 Medium
每实例每次渲染跑逐字符 `parse()` 并读 `theme`，theme 切换会重渲并重解析所有可见着色串（有界 500 行，非灾难但属热路径白工）。无 `§`/`&` 的早退已缓解常见情形。**修复**：`React.memo` + `useMemo(parse(text), [text])`。

<a id="uicore-8"></a>**[UICORE-8] `connect()` 不重置上次会话的 per-bot 状态** · Minor · Bug · `engine.ts:172-176/281-288` · 置信 Medium
切换引擎时 `disconnect/connect` 都不清 `logs/inventory/windows/scriptRuntime/monitorStats`。新引擎 `BOTS_SNAPSHOT` 经 `setBots` 替换 `bots`，但旧引擎 bot id 键的 logs/inventory/windows 残留，id 偶然相同会短暂显示别的引擎陈旧数据，并叠加 UICORE-1。**修复**：加 `resetSession()` 在 `disconnect()`/`connect()` 顶清空全部 per-bot 映射与 `selectedId`。

### 8.6 UI 功能页（UIFEAT）

> 关键架构结论：**`Viewer.tsx` 不在组件内跑 three.js/WebGL**，而是 `<iframe src={http://host:port}>` 指向服务端 prismarine-viewer 渲染服务。故无组件内 renderer/geometry/texture 需 dispose；GPU/上下文泄漏面在服务端 `viewer.start/stop` 之后。Viewer 的卸载清理（cancelled 守卫 + `viewer.stop` + 键盘监听移除）总体正确。

<a id="uifeat-1"></a>**[UIFEAT-1] `HoldButton` 在持握中卸载会泄漏 interval（且 bot 一直转）** · Important · Memory Leak · `Joystick.tsx:95`（被 `Viewer.tsx:319-341` 使用）· 置信 High
`HoldButton` 在 pointer-down 启 `setInterval`，仅在 up/cancel/leave 清，**无 unmount 清理**。walk 模式转向/跳跃按钮在 Viewer 的 `{walk && …}` 浮层里：持握"左转"时切 tab/关弹窗/`walk` 翻 false 导致卸载 → pointer-up 不触发于已移除元素 → interval 永远调 `cmd.control.turn`（既泄漏定时器又让 bot 一直转）。**修复**：`HoldButton` 加 `useEffect(()=>()=>{clearInterval(timer.current)},[])`，并发停止指令。

<a id="uifeat-2"></a>**[UIFEAT-2] Viewer 在第一人称/重试切换时 start/stop 竞态** · Important · Race · `Viewer.tsx:63-84` · 置信 Medium
start effect deps `[started,firstPerson,bot.id,nonce]`。任一变更先 cleanup(`viewer.stop`) 再新 body(`viewer.start`)，二者皆异步 ack 无顺序保证。快速切第一人称（或 `toggleWalk` 在 168 `setFirstPerson(true)`、重试 bump `nonce`）时，上一渲染的 `stop` 可能在新 `start` 之后 resolve，拆掉刚启动的 viewer → iframe 指向已被杀端口（start ack 返 ok，`err` 浮层也抓不到）。**修复**：effect 内先 `await stop` 再 `start`，或服务端 `viewer.start` 按 bot id 幂等/原地重启 + 用 generation 计数忽略过期结果。

<a id="uifeat-3"></a>**[UIFEAT-3] 弹出视角时两个 Viewer 实例短暂指向同一 bot** · Minor · Race · `LiveTab.tsx:61-68` · 置信 Medium
`popout` 翻 true 时内联 Viewer 卸载（cleanup `viewer.stop(bot.id)`）与 `ViewerModal` 的 `<Viewer autoStart>`（`viewer.start(bot.id)`）顺序无保证，`stop` 可能在 `start` 后落地杀掉弹出视角（与 UIFEAT-2 同根，跨组件）。注释 60 行表明已知此意图但 swap 非原子。**修复**：服务端 `start/stop` 按 bot 幂等/引用计数，或门控 modal start 直到内联 stop resolve。

<a id="uifeat-4"></a>**[UIFEAT-4] OverviewTab 轮询读取不在依赖数组里的模块标志（陈旧闭包 + deps 不一致）** · Important · Bug · `OverviewTab.tsx:61-87` · 置信 High
`poll` 闭包按 `m.automine/m.autofarm/m.mobhunter`（72-74）分支取数，但 deps（87）列了 `m.combat/m.fishing/m.trashcleaner`（**未被 effect 读**）——切 combat/fishing 会无谓重建 interval；而当 `bot.modules` 身份变但这些值不变时，interval 保留首个 `poll` 闭包。今天恰好正确仅因分支输入都在 deps 里，脆弱且 body/deps 不一致。**修复**：去掉未用的 deps，或 `const jobsKey=[m.automine,m.autofarm,m.mobhunter].join()` 并依赖 `[bot.id,bot.online,prefs.intervalSec,jobsKey]`。

<a id="uifeat-5"></a>**[UIFEAT-5] 可变/可重排列表用数组索引做 React key** · Minor · Bug · `OverviewTab.tsx:213-214/287-288/345-352/367-368`、`ScriptEditor.tsx:245-256`、`Console.tsx:103-105` · 置信 Medium
feed/players/scoreboard/bossBars 周期重取、顺序/长度变；尤其 ScriptEditor 步骤可移动/增删，索引键致 React 错配 DOM/state（重排时子输入焦点/非受控态串到错行）。**修复**：用稳定身份（玩家名/行文本/步骤 `id`）；步骤在 `StepList.add` 时分配稳定 `id` 并以之为 key。

<a id="uifeat-6"></a>**[UIFEAT-6] InventoryTab tooltip 每像素 mousemove 都 setState** · Minor · Performance · `InventoryTab.tsx:335-336`（`useLayoutEffect` 316-329）· 置信 Medium
"full" 模式每个带 tooltip 的 `ItemRow` 在每次 `onMouseMove` `setTip({x,y})`，触发重渲 + 重跑定位 layout 读取（`offsetWidth/Height`）。满背包 + 快速移动 = 持续重渲热点（`GuiWindow.tsx:125` 同）。**修复**：用 CSS transform 跟随 / rAF 合并 / ref + 命令式样式更新，或仅在位移超阈值时 setState。

<a id="uifeat-7"></a>**[UIFEAT-7] GuiWindow 在早返回后读取 store（非 hook，但易误改成 hook 而崩）** · Minor · Code Quality · `GuiWindow.tsx:39-42` · 置信 High
`if(!win) return null;` 后 `useStore.getState().setWindow`（非 hook，故不违反 Rules of Hooks），但紧贴真 hook 之下、读起来像 hook，是维护陷阱（后人改成 `useStore(s=>s.setWindow)` 即把 hook 放到条件返回后而崩）。**修复**：把 `getState()` 读取移到 `if(!win)` 守卫之上。

<a id="uifeat-8"></a>**[UIFEAT-8] ScriptEditor JSON 解析路径可静默丢数据** · Minor · Error Handling · `ScriptEditor.tsx:96-103/104-115` · 置信 Medium
try/catch 只挡语法；visual↔JSON 往返经 `toEdit(JSON.parse)`，若粘贴合法 JSON 但非合规脚本（`steps` 缺失/非数组），`toEdit`（20-31）回退默认 `steps:[]`**静默丢弃**用户内容；JSON 模式 `save()` 直接 `onSave(JSON.parse(json))` 无 schema 校验，畸形但可解析的脚本被发往引擎。**修复**：解析后校验最小形状（对象 + 字符串 `name` + 数组 `steps`），失败明确报错而非回退默认；`switchMode`/`save` 复用同一校验助手。

<a id="uifeat-9"></a>**[UIFEAT-9] AiTab 挂载即 fetch 无 unmount 守卫** · Minor · Race · `AiTab.tsx:37-47`（`CustomJsPanel.tsx:30-37`、`ScriptEditor.tsx:78-85` 同）· 置信 High
`refresh()`：`setLoading(true)`→`await cmd.observe`→`setObs/setLoading`，挂载 effect 无 `cancelled` 标志。8s 超时 ack 在途时切 tab/bot 卸载会对已卸载组件 setState。与代码库其余一致采用的 `cancelled` 守卫不一致。**修复**：套 `let cancelled=false; ...; return ()=>{cancelled=true}` 并在 setState 前 bail。

<a id="uifeat-10"></a>**[UIFEAT-10] ItemRow 每行订阅 pushToast，列表组件偏重** · Minor · Performance · `InventoryTab.tsx:303` · 置信 Low
每个 `ItemRow` `useStore(s=>s.pushToast)` 并各自维护 `tip`/`tipStyle`，满背包数十个订阅 + 组件 state，仅为点击报 toast。**修复**：把 `pushToast`/`onError` 提升到父级传入，行组件保持纯展示。

### 8.7 桌面 Rust / 构建 / 协议（DESK）

> 最高价值问题答案：**正常退出时引擎子进程被可靠回收**（`kill_engine` 挂 `RunEvent::Exit`，`Child` 存于 `EngineState` 并 `take()` reap），崩溃/强杀由引擎父 PID 看门狗 ~3s 自杀兜底。唯一真实缺口是 **`restart_app`（切换引擎源）绕过 `kill_engine`**（DESK-1）。

<a id="desk-1"></a>**[DESK-1] 切换引擎源的 `restart_app` 会泄漏旧内置引擎，直到看门狗回收** · Important · Memory Leak · `lib.rs:81-83` · 置信 Medium
`set_engine_config → restart_app → app.restart()`（`engine.ts:154-166` 确认）。`app.restart()` 不派发 `RunEvent::Exit`，故 `kill_engine`（`:267-269`）不跑，旧 `node.exe` 被孤立。新进程或再起第二个内置引擎或连远程，旧引擎仍占端口/数据目录。父 PID 看门狗（`serve.ts:19-26`，3s 轮询）最终杀之（故有界 ~3s，非永久），但窗口内双引擎运行 + 端口竞争（DESK-2）。**修复**：`restart_app` 内 `app.restart()` 前显式 `kill_engine(&app)`（并短暂 `child.wait()` 确认退出），使重启确定化。

<a id="desk-2"></a>**[DESK-2] 选空闲端口有 TOCTOU 竞态，引擎重启可落到被占端口** · Minor · Race · `lib.rs:87-92` · 置信 High
`pick_free_port` 绑 `127.0.0.1:0` 读端口后**丢弃 listener**再把裸端口号传子进程。释放到子进程 `server.listen`（含 Node 启动+初始化，数百 ms）之间，他进程（含未回收的旧引擎，DESK-1）可抢占。引擎 `server.listen` 无重试（`server.ts:339-341`），冲突即抛、`serve.ts:42-44` 退出码 1，app 静默无引擎（`engine_info` 返回死进程陈旧 URL）；`unwrap_or(8137)` 兜底也是固定端口。**修复**：引擎对 `EADDRINUSE` 重试若干次，和/或 Rust 侧 spawn 后健康检查、失败重选端口；至少把失败上抛 UI。

<a id="desk-3"></a>**[DESK-3] 子进程 stdio 继承而非排空，长跑引擎可能因管道满死锁（环境相关）** · Minor · Bug · `lib.rs:132-145` · 置信 Low
`spawn` 未配 stdout/stderr，子进程继承父句柄。GUI 构建（`windows_subsystem="windows"`）无控制台，继承句柄约等于 null，当前 OK。但引擎极啰嗦，若从控制台启动/dev/未来改 `Stdio::piped()` 而无排空读线程，OS 管道缓冲(~4-64KB)满则引擎阻塞于 `console.log` 卡死 bot 管理。当前潜伏非活跃。**修复**：GUI 构建显式 `.stdout(Stdio::null()).stderr(Stdio::null())`；若要日志则 `piped()` + 持续读线程/重定向文件。绝不 pipe 而不排空。

<a id="desk-4"></a>**[DESK-4] `set_engine_config` 无校验、有损写入、静默忽略 `create_dir_all` 失败** · Minor · Error Handling · `lib.rs:69-76` · 置信 High
(1) `mode` 自由字符串无校验，非 `"remote"` 一律按内置（`load_remote_engine`，`:42`），`"Remote"`/`"REMOTE"` 静默回退内置无反馈。(2) `let _ = create_dir_all(dir)` 丢错。(3) `to_string_pretty(&v).unwrap_or_default()` 序列化失败写**空串**→后续解析为"无远程"静默回退内置。**修复**：`mode` 校验 `{"builtin","remote"}` 否则 `Err`；`create_dir_all` 用 `?`/`map_err` 上抛；`unwrap_or_default()` 改 `map_err(...)?`。

<a id="desk-5"></a>**[DESK-5] 托盘设置里 `default_window_icon().unwrap()` 可在启动 panic** · Minor · Error Handling · `lib.rs:212` · 置信 Medium
无默认窗口图标解析（打包回归/图标缺失损坏）时 panic，配合 `panic="abort"` 启动即崩溃、无 UI 无诊断。是启动路径上唯一未防御的 `.unwrap()`。**修复**：`if let Some(icon)=app.default_window_icon(){...}` 优雅回退，或在 `setup`（返回 `Result`）里 `?` 上抛清晰错误。

<a id="desk-6"></a>**[DESK-6] 协议"单一事实源"被违反：引擎 emit 硬编码事件名字符串而非 `ServerEvents`** · Important · Code Quality · `protocol/src/index.ts:269-275` · 置信 High
协议声明为单一事实源并定义了 `INVENTORY/WINDOW_OPEN/CLOSE/UPDATE` 常量，但引擎在 `.js` 模块里硬编码字面量：`window_gui.js:247/231/260` 的 `"window_open/update/close"`、`player_inventory.js:70` 的 `'player_inv_data'`（`.ts` handler 却正确用 `ServerEvents`）。一旦重命名常量，TS 消费者更新而 `.js` emit 端静默沿用旧线名，UI 静默收不到库存/窗口更新且无编译错误。**修复**：`window_gui.js`/`player_inventory.js` import 并用 `ServerEvents` 常量 emit。

<a id="desk-7"></a>**[DESK-7] 默认引擎端口常量与桌面回退漂移** · Minor · Code Quality · `protocol/src/index.ts:518` · 置信 High
协议 `DEFAULT_ENGINE_PORT=8723`（引擎实际默认，`server.ts:37`），而 Rust 在 `pick_free_port` 硬编码无关回退 `8137`（`lib.rs:91`）且从不引用协议常量。Rust 无法 import TS 常量→手工同步隐患，同概念两个默认端口。**修复**：至少注释标明 canonical=8723 及差异原因，或对齐回退，长期用 build script 由协议生成 Rust 常量。

<a id="desk-8"></a>**[DESK-8] `make-engine-bundle.mjs` 吞错，可静默产出残缺 bundle** · Important · Error Handling · `make-engine-bundle.mjs:50-55/124-135` · 置信 Medium
正确性闸 `countTopLinks()` 在 `node_modules` 不存在时返回 `-1`（`:53`），而最终检查只对 `links>0` 警告（`:131`）——`-1`（缺 `node_modules`，即失败/空部署）静默通过"自检通过"分支；配合多处空 `catch {}`，残缺部署产出脚本看来正常、运行时才 "Cannot find module"。也未验证 `dist/bin/serve.js`（Rust 侧运行的入口，`lib.rs:134`）存在。**修复**：`links<0` 视为硬错误；构建后断言 `node.exe`/`dist/bin/serve.js`/非空 `node_modules` 存在，缺失 `exit(1)`。

<a id="desk-9"></a>**[DESK-9] `execSync` 部署无失败守卫，且不校验 `variant`** · Minor · Error Handling · `make-engine-bundle.mjs:14/61-64` · 置信 Medium
(1) `variant`(argv[2]) 不校验，非 slim/full（如 `fll`）静默不跑任何裁剪，产出臃肿但不显错的 bundle。(2) `execSync(pnpm deploy)` 抛前已 `fs.rmSync(out)` 毁掉旧好 bundle → 失败后无任何 bundle + 裸栈。**修复**：`variant` 先校验 `["slim","full"]`；`execSync` 套 try/catch 给可操作信息；构建到临时目录成功再换入,避免毁旧。

<a id="desk-10"></a>**[DESK-10] capability 描述称"shell open"但未授予 shell 权限（文档/范围不符）** · Minor · Code Quality · `capabilities/default.json:4` · 置信 High
`description` 写"...+ shell open"，但 `permissions` 无 `shell:*`、Cargo 无 shell 插件。审计者会误信已允许 shell-open（实际未），或后人误以为已覆盖而重加插件。实际授予范围正确最小。**修复**：描述去掉"shell open"，或若确需开外链则加紧范围的 `shell:allow-open` 并保持描述准确。

<a id="desk-11"></a>**[DESK-11] 协议类型不一致削弱安全/可致静默运行时缺口** · Minor · Bug · `protocol/src/index.ts:53-77/227-231/336-338` · 置信 Medium
(1) `BotSettings` 在具名字段上又加 `[key:string]:unknown`（76），击穿多余属性检查，typo 键（`autoReconect`）被静默接受且引擎从不读（`ScriptStep` 362 同）。(2) `savedLocations?` 在 `BotSummary`(223) 与 `BotStatus extends BotSummary`(229) 重复声明。(3) `MODULE_TOGGLE/CONFIG` 的 `module` 是严格 `ModuleName`(336-337)，而 `MODULE_ACTION`/`MODULE_STATE/DATA` 是 `string`(290-291/338)——松紧不一，松的不挡 typo。**修复**：去掉 `BotSettings/ScriptStep` 的索引签名（或改显式 `extra?:Record<...>`）；删重复 `savedLocations`；`module` 字段统一用 `ModuleName`。

---

## 9. 亮点（值得保持的好设计）

- **生命周期清理契约**：`cleanup()` 跑 hooks → 清 `timers` → `removeAllListeners()` + `quit()`，每次重连新建 bot；大量模块（combat/message_monitor/script_engine/auto_farm/fishing/scoreboard/trash_cleaner/scheduler/player_inventory/window_gui 等）对称注册/移除监听与清定时器。`fishing.js` 在 `finally` 清定时器是范本。
- **存储健壮**：`storage.ts` 区分"缺失/损坏"、损坏文件隔离为 `.corrupt-<ts>`、原子 temp+rename + 校验 `.bak` 回滚；配置同步落盘，崩溃几乎不丢配置。
- **重连安全**：致命踢出检测不消耗重试上限；30s 稳定计时器门控重试计数重置，防"登录即踢"绕过上限。
- **脚本引擎无限循环防御**：`MAX_TOTAL_STEPS`(1e5)、`MAX_CALL_DEPTH`、空 `repeat` 检测、`while` `maxIter` 上限、`aborted` 贯穿、`await sleep(0)` 让出事件循环；`waitForChat`/`wait_spawn` 在所有 resolve 路径（含 abort）清定时器+移除监听。
- **automine 范本**：单个自清滚动 `setTimeout`（schedule 先 clear 再 set），刻意不把每 tick 定时器塞进 `timers`（带注释解释规避无界增长），FSM 顶部 `task.active`/`bot.entity` 守卫。
- **mob_hunter 监听卫生**：5 个监听由 `hunterListenersAttached` 标志守卫，绝不重复订阅，toggle(false) 与 cleanupHook 对称移除；`damageHistory` 有 TTL GC。
- **桌面子进程治理**：`kill_engine` on `RunEvent::Exit` + 父 PID 看门狗双保险；引擎仅 `127.0.0.1` 绑定、每次随机 UUID 令牌、`CREATE_NO_WINDOW`、Tauri 能力集最小、release 硬化（`panic=abort`/`strip`/`lto`）。
- **前端**：socket.io-client 自管底层 socket/重连（无手搓 onmessage/heartbeat 堆叠泄漏），`connect()` 先 `disconnect()` 再清监听；store `logs`(500)/`chat`(30) 有界、不可变更新；轮询 effect 普遍用 `cancelled` + `clearInterval`；localStorage 访问统一 try/catch；zustand v5 用模块级 `EMPTY_*` 常量避免无限重渲。
- **安全正向**：自定义 JS（最高危）默认禁用且带醒目警告；`chatSafety` 被 socket 与脚本引擎共用；observe 各段 try/catch 优雅降级；几乎所有 socket handler try/catch 返回 `fail(...)` 而非抛出。

---

## 10. 附录：方法与范围

**审查方式**：7 个并行只读子代理按区域分工（核心/模块A/模块B/API/UI基础/UI功能/桌面），各自完整读取所分配文件并给出 file:line 级发现；主代理对 CORE-1、CORE-2/API-8、UICORE-1、MODB-2、API-1、API-2 等高危/被多方独立印证的结论逐条读取实际行号复核。**全程未修改任何代码。**

**已审文件**（节选，按行数）：
- Engine：`BotInstance.js`(635)、`script_engine.js`(1070)、`mob_hunter.js`(728)、`moduleHandlers.ts`(448)、`observe.ts`(380)、`botManager.ts`(363)、`server.ts`(346)、`auto_farm.js`(324)、`automine.js`(320)、`window_gui.js`(273)、`player_inventory.js`(240)、`message_monitor.js`(219)、`storage.ts`(92)、`chatSafety.js`、`reconnectPolicy.js`、`debouncedSave.js`、`validateEnv.js`、`passwordValidator.js`、`token.ts`、`connectionInfo.ts`、`test/control-plane.cjs` 等全部模块与 utils。
- UI：`OverviewTab.tsx`(582)、`MonitorPanel.tsx`(516)、`engine.ts`(462)、`InventoryTab.tsx`(429)、`Viewer.tsx`(419)、`ScriptEditor.tsx`(366)、`ScriptsTab.tsx`(344)、`ModulesTab.tsx`(325)、`BotPanel.tsx`(323)、`useStore.ts`(214)、`SettingsDialog.tsx`(233) 及全部 components/lib/features。
- 桌面/协议：`lib.rs`(271)、`main.rs`、`build.rs`、`make-engine-bundle.mjs`(137)、`generate-icon.cjs`、`protocol/src/index.ts`(518)、`Cargo.toml`、`capabilities/default.json`。

**未覆盖/超出本次范围**：运行时动态分析（实际内存快照/堆增长曲线）、依赖供应链审计、Android (`apps/mobile` 暂无源)、prismarine-viewer patch 内容、构建产物体积实测。建议后续补一次"长跑 24h 内存曲线 + heap snapshot diff"以实测验证本报告标注的泄漏面。

**复核状态**：标注 ✅ 已读实际行号验证的有 CORE-1、CORE-2/API-8、UICORE-1、MODB-2（含 `ENGINE_ALLOW_JS` 门控）、API-1、API-2；其余为子代理 file:line 级结论，置信度已逐条标注（High/Medium/Low）。
