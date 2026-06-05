# 可配置顶栏指标 + 重连配置 — 设计

- 日期：2026-06-05
- 范围：`packages/ui`（顶栏指标）、`packages/engine` + `packages/protocol` + `packages/ui`（重连配置）
- 状态：已与用户确认设计，待实现

## Context（为什么）

两个「可配置性」诉求：

1. **顶栏指标固定死**：`BotPanel` 顶部固定显示 生命/饱食/等级/延迟/坐标。用户希望可任意配置，尤其对**有计分板的服务器**，能把计分板里的金币/点卷/战力等数字提取出来钉到顶栏。要做成「自动识别计分板行 → 勾选钉住」的通用系统，**每服务器(host)独立配置**。
2. **自动重连无配置项**：引擎一直自动重连（指数退避 + 最多 `maxReconnectAttempts` 次，默认 10；ban/白名单等不可恢复会自动停）。但 UI 没暴露任何旋钮、也无开关。用户认为默认 10 次太少（7×24 挂机应默认无限）。

---

## 功能一：可配置顶栏指标（每服独立）

### 形态
顶栏 = 一组**可配置指标卡**，两类来源：
- **内置**：生命 / 饱食 / 等级 / 延迟 / 坐标，每个可勾选显隐。
- **计分板自定义**：从 sidebar 行自动识别「标签+数字」，勾选要钉的。

无配置时 = 现在的默认 5 项内置（零打扰、向后兼容）。

### 提数字核心
计分板 sidebar 行（原始带 §，`observe.scoreboard` 已抓）逐行处理：
- `cleanLine(raw)` = 去 §/& 色码（复用 `mcPlain`）→ 如 `金币: 1,234,567`。
- `extractNumber(clean)` = 匹配 `数字[,逗号][.小数][万/亿/兆/k/m]?`，按单位换算成数值（复用 message_monitor 的 `parseNum` 同款：万=1e4/亿=1e8/兆=万亿=1e12）。返回 `{ value, raw, index }`。
- `labelKey(clean)` = 去掉数字片段后的剩余文字（trim 掉尾部 `:`、空白）→ 如 `金币`。**这是稳定标识**。

### 实时更新
钉住的是 **labelKey**（不是某个定值）。每次计分板刷新：对每个钉住的 metric，按 labelKey 在当前 sidebar 找匹配行、提当前数字 → `fmtBig(value)` 显示。匹配不到（行消失/改格式）→ 显示 `—`，不报错。

### 配置入口
顶栏指标区一个 **⚙** → 弹出小面板：
- 「内置」分区：5 个开关。
- 「计分板」分区（仅当有 sidebar 时）：列出每条 sidebar 行（cleanLine + 识别到的数字预览），复选框勾选即钉。
- 实时反映；关闭即生效。

### 持久化
**localStorage，按 host**：`mcbot.headerMetrics.<host>`，结构
```ts
{ builtins: { health:bool, food:bool, level:bool, ping:bool, pos:bool },
  pinned: Array<{ labelKey: string; label: string }> }
```
同一 host 的多个机器人共享（同服=同计分板）。客户端存储，单主人足够；与 MonitorPanel 预设一致。

### 代码切分（隔离清晰）
- `packages/ui/src/lib/headerMetrics.ts`：纯函数 + 类型。`BUILTIN_METRICS`（id/label/icon/getValue(bot)）、`cleanLine`/`extractNumber`/`labelKey`、`loadCfg(host)`/`saveCfg(host,cfg)`、`computeMetrics(bot, scoreboard, cfg) → {label,value,icon,tone?}[]`。
- `packages/ui/src/features/bot/HeaderMetricsConfig.tsx`：⚙ 配置弹层。
- `BotPanel.tsx`：用 `computeMetrics` 渲染指标卡 + ⚙ 按钮（替换现固定 5 卡）。

### 复用
`observe.scoreboard`（已抓）、`fmtBig`/`parseNum`（单位）、现有 `Metric` 卡样式、按 host 存 localStorage 套路（背包常用/监听预设）。

### 范围（YAGNI）
v1 仅计分板来源。tablist/bossbar/聊天来源、手动正则规则 = 后续扩展，不在本版。

---

## 功能二：重连配置（每机器人独立）

把现有「已从 settings 读、但 UI 没暴露」的参数暴露出来 + 加开关：

| 配置 | 字段 | 默认 | 说明 |
|---|---|---|---|
| 自动重连 | `settings.autoReconnect` | **true** | 关 → 断线不再自动重连 |
| 最大重试次数 | `settings.maxReconnectAttempts` | **0 = 无限**（改默认，原 10 太少） | 设正数则到次数停 |
| 重试间隔(秒) | `settings.reconnectDelay` | 5 | 基础间隔；之后 ×1.5 指数退避到 ×10 |

### 引擎改动（`BotInstance.js`）
- `maxReconnectAttempts` 初始化：`?? 0`（0/未设 = 无限）。
- `handleReconnect()`：
  - 开头加 `if (this.config.settings?.autoReconnect === false) { 记日志 + emit bot_error「已关闭自动重连」; return; }`。
  - 次数上限判断改为 `const max = this.maxReconnectAttempts; if (max > 0 && this.reconnectAttempts >= max) { stop }`（0=无限不触发）。
  - 不可恢复(fatal)停连逻辑**不变**（开关/无限都救不了 ban）。

### 协议（`protocol/src/index.ts`）
`BotConfig.settings`（或其类型）补 `autoReconnect?: boolean; maxReconnectAttempts?: number; reconnectDelay?: number`（若 settings 是宽松对象则仅注释说明）。

### UI（`AddBotDialog.tsx`）
新增「连接/重连」分区：自动重连开关、最大重试次数（0=无限）、重试间隔(秒)。保存进 `settings`（已持久化到 bots.json）。

---

## 验证
- `pnpm -C packages/ui build` 零类型错误；重建后 reload 预览。
- 顶栏指标：mcly（有计分板）开 ⚙ → 勾选金币/战力 → 顶栏出现且随计分板刷新跳数；切到无计分板服 → 仅内置；内置开关显隐生效；刷新页面配置仍在（按 host）；换服配置不串。
- 重连：编辑机器人设 自动重连=关 → 停止某 bot/断线 → 不再自动重连（日志/提示）；设回开 + 最大次数=0 → 无限重连；间隔生效。
- 全程 git 可回滚；`.test-data`/`.env` 不入库。

## 风险/回滚
- 顶栏指标纯前端（localStorage）；重连配置 = 引擎读 settings + UI 表单，改动小、可回滚。
- 改 `maxReconnectAttempts` 默认（10→无限）会影响所有现有机器人（变为一直重连）——这正是用户要的；fatal 检测仍兜底，不会对被 ban 账号空转。
