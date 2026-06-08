# 服务器配置包（ServerPack）设计

> 状态：设计已批准（2026-06-08）。本周暂不实现（用户聚焦实时视角优化），spec 存档待 writing-plans。

## 背景 / 动机

用户希望「不碰源码也能让别人定制自己服务器的功能」。当前项目**已有一个「整机备份」**（设置 → 配置备份/迁移）：导出 `DataBundle = { schemaVersion, exportedAt, bots[], scripts, customScripts }`，用途是用户**自己换设备整体搬家**。

缺口在于：

1. 整机备份是「全部机器人 + 全部脚本」，不是按**单个服务器**分享的单元。
2. 它只覆盖**引擎侧**数据（`bots.json` / `scripts.json` / `custom_scripts.json`）。用户为某服精心配置的两类 **浏览器本地 per-host** 数据完全不在其中、换浏览器即丢、也分享不出去：
   - `mcbot.headerMetrics.{host}` —— 顶栏指标 / 从计分板提数字（RPG 服最花心思的 HUD）。
   - `mcbot.quickCmds.{host}` —— 该服的快捷指令按钮。
3. 整机备份含 `loginPassword`，不适合分享。

**ServerPack** 解决的是「**按服务器、可分享、默认无密钥**」这件不同的事。现有整机备份保留不动。

## 与「整机备份」的区别

| 维度 | 整机备份 DataBundle | ServerPack（新） |
|---|---|---|
| 单元 | 全部机器人 | 单个 host |
| 用途 | 自己换设备 | 分享给别人 / 按服迁移 |
| 密钥 | 含 loginPassword | **永不含密码** |
| 浏览器 per-host 配置 | ❌ 不含 | ✅ 含 headerMetrics + quickCmds |
| 组装位置 | 引擎侧 exportData() | **UI 侧**（唯一能同时读 localStorage + 问引擎要数据的地方） |

## 数据格式

```jsonc
{
  "kind": "mcbot.serverpack",
  "schemaVersion": 1,
  "exportedAt": "2026-06-08T12:00:00.000Z",   // 由 UI 盖时间戳
  "source": { "host": "...", "port": 25565, "version": "1.20.1", "note": "可选别名" },
  "includesAccount": false,
  "account": { "username": "...", "auth": "offline" },   // 仅模式B；永不含 loginPassword
  "settings": { /* 该机器人的 BotSettings：模块开关+参数+行为(allowDig/respawnCommand/returnOnDeath)+schedules+savedLocations+monitorRules */ },
  "ui": {
    "headerMetrics": { /* HeaderCfg：builtins{health,food,level,ping,pos} + pinned[] */ },
    "quickCmds": [ { "id": "...", "name": "...", "command": "..." } ]
  },
  "scripts": [ /* server===host 的可视化脚本 BotScript[] */ ],
  "customScripts": [ { "name": "...", "code": "..." } ]   // 导出者勾选的原生 JS
}
```

`account` / `ui.*` / `scripts` / `customScripts` 均为可选；缺省即不含该切片。

## 决策记录

- **包范围（用户拍板：两种模式都做）**：导出时一个 `包含账号用户名` 勾选 → `includesAccount`。
  - 模式 A（默认，关）：纯配置，不含账号，最适合分享。
  - 模式 B（开）：额外带 `account.username` + `auth`，导入可一键新建该服机器人（**密码仍永不含**，需导入方自填）。
- **自定义原生 JS（用户拍板：带上 + 导入逐段确认）**：
  - 导出：JS 无 host 标签，故由**导出者在清单里逐个勾选**要带哪几段（默认全不选，避免把全局/无关 JS 倒进分享包）。
  - 导入：**逐段显式确认**——每段折叠代码预览 + 独立勾选，默认全不勾，附 ⚠️「执行任意代码、仅当本机 `ENGINE_ALLOW_JS=1` 才运行」。
- **导出入口**：设置面板新增「服务器配置包」区，默认以当前查看的机器人为模板。
- **localStorage 导入策略**：`headerMetrics.{目标host}` **替换**；`quickCmds.{目标host}` 按 `名字+命令` **去重追加**。
- **改投 host**：导入预览里目标 host 默认=来源 host，可改（决定 per-host localStorage 键写到哪）。

## 导出流程（UI 组装）

1. 设置面板「服务器配置包」区：选机器人（默认当前）→ 勾选 `包含账号` / 在 JS 清单里勾要带的段。
2. UI 调**新引擎命令 `SERVERPACK_EXPORT { botId, includeAccount, customScriptNames[] }`**：服务端组装该 host 的 `settings` + `server===host` 的可视化脚本 + 选中的 customScripts，**强制剥离 `loginPassword`**（绝不把全量密码下发浏览器），按 `includeAccount` 决定是否带 `account.username/auth`。
3. UI 读 `localStorage` 的 `mcbot.headerMetrics.{host}` / `mcbot.quickCmds.{host}` 并入 `ui` 段。
4. 盖 `exportedAt` 时间戳，下载 `mcbot-serverpack-{host}-{date}.json`。

## 导入流程（预览 → 确认）

1. 选文件 → 校验 `kind === "mcbot.serverpack"` 且 `schemaVersion` 已知，否则拒绝。
2. **预览确认弹窗**：
   - 显示 `source`（host/port/version）与内容摘要（N 条快捷指令 / N 个脚本 / 顶栏指标有无 / N 段 JS）。
   - **套用目标**：`新建该服机器人`（仅模式B，密码留空待填）或 `套用到现有机器人 [下拉]`。
   - **目标 host 可改**（默认=来源 host）。
   - **JS 逐段确认**：列每段 名字 + 折叠代码 + 独立勾选（默认全不勾）+ ⚠️ 提示。
3. 确认后：
   - UI 写 `localStorage`：`headerMetrics.{目标host}`（替换）、`quickCmds.{目标host}`（去重追加）。
   - UI 调**新引擎命令 `SERVERPACK_IMPORT { target: {botId} | {newBot}, settings, scripts, customScripts(仅勾选) }`**：把 `settings` 经现有 `SETTINGS_SANITIZERS` 套到目标机器人 / 或建新机器人（无密码）；可视化脚本写入 `scripts.json`（按名去重，冲突加后缀）；已确认 JS 写入 `custom_scripts.json`。
4. Toast 提示完成。

## 安全

- 导出**永不含密码**：剥离在**服务端**（`SERVERPACK_EXPORT`），不依赖前端过滤。
- 账号信息即便带上也仅 `username + auth`。
- 导入的 `settings` **必过现有 `SETTINGS_SANITIZERS`**：未知键丢弃、`monitorRules` 正则走既有 ReDoS 限制 → 恶意包注入不了野字段。
- `customScripts` **双重门**：导入逐段 opt-in + 没开 `ENGINE_ALLOW_JS` 则惰性不运行。
- `savedLocations` / `schedules` 内的命令在**发送时**仍过 `isChatBlocked` 过滤，与手输命令同等约束。
- 校验 `kind` / `schemaVersion`，拒绝未知包。

## 文件改动清单

**协议** `packages/protocol/src/index.ts`
- `ServerPack` 类型 + `ServerPackExportInput` / `ServerPackImportInput`。
- 命令常量 `SERVERPACK_EXPORT` / `SERVERPACK_IMPORT`。

**引擎**
- `api/handlers.ts`（或 moduleHandlers）：`SERVERPACK_EXPORT`（host 切片 + 剥密码 + 按需带 account）、`SERVERPACK_IMPORT`（套 settings / 建机器人 / 加脚本 / 加确认 JS）。
- 复用 `botManager.ts` 现有 `exportData/importData` 的脚本/JS 落盘逻辑。

**UI**
- 新 `lib/serverPack.ts`：组装 / 拆解 / 校验 / 下载上传。
- `lib/engine.ts`：`cmd.serverPack.export(...)` / `cmd.serverPack.import(...)` 类型化封装。
- `components/SettingsDialog.tsx`：新「服务器配置包」区（导出选项 + 导入预览确认弹窗），复用 `headerMetrics.ts` / `quickCommands.ts` 读写。

**不动**：现有整机备份、所有模块逻辑、Viewer。

## 验证（端到端）

1. 构建 protocol → engine → ui，零类型错误。
2. 连 mcly：
   - 导出一个包 → 查 JSON **无 loginPassword**、含 `settings` + `ui.headerMetrics` + `ui.quickCmds`。
   - 导入到另一机器人 / 改投 host → 设置生效、顶栏指标与快捷指令出现在新 host、JS 需逐段勾且默认惰性不跑。
   - 确认现有「整机备份」导出/导入无回归。

## 风险 / 回滚

- 引擎只增两个命令、不改既有数据结构；UI 为主。全程 git 可回滚。
- `.test-data/bots.json`（明文密码）/ `.env` 仍仅本地、gitignore，不提交。
- 仅在用户确认后分批提交。
