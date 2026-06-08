# 死亡返回（挂机死亡后回到原位）— 设计

- **日期**：2026-06-08
- **状态**：已与用户确认（方案 A，模组服寻路暂不优化）
- **背景**：机器人挂机时死亡会回到服务器出生点/主城，离开了原来的挂机位置（钓鱼孔/刷怪点/副本内）。需要一种**通用、可配置**的方式让它死后回到原位。

## 设计原则
- **通用、不写死任何服务器**：返回流程因服而异（命令 / 选副本菜单 / 走位），由用户按服配置。
- **复用现有能力**：脚本引擎已有 `respawn` 触发器 + `cmd`/`find_and_click_slot`（选副本菜单）/`goto`/`goto_location` 等步骤，本就能做复杂返回。本设计只补「让它好用」的两块。
- **分两档**：简单场景一个开关搞定；复杂场景（选副本）走脚本。

## 现状（已覆盖的部分）
- `respawnCommand`（行为设置）：死后 1.5s 跑**一条**命令（过 chatSafety）。命令式回点已覆盖。
- `respawn` 脚本触发器（script_engine.js:1100/1138/1141）：重生后 2s 内自动跑带 `trigger:respawn` 的脚本。
- 脚本步骤：`cmd`、`find_and_click_slot`/`wait_gui_item`（菜单/选副本）、`goto`/`goto_location`、`return_home`、控制流、变量。
- **缺口**：没有「自动记录死亡前坐标」暴露给脚本/行为；要走回精确点必须先手动存地点。

## 方案（增量，三部分）

### 1. 引擎：捕获死亡点（BotInstance.js）
- 存活时持续记录最后坐标 `this._lastAlivePos`（复用已有的 2s 状态 interval 顺带更新，或在 `updateStatus` 里写）。
- `bot.on('death')`：把 `this._deathPos = this._lastAlivePos`（死亡瞬间 entity 可能已失效，故用「上一次存活坐标」），记一条可见日志 `已记录死亡点 x,y,z`。
- `_deathPos` 形如 `{x,y,z}`，连接级状态（重连后随首个存活坐标重新累积；不持久化到磁盘）。

### 2. 行为开关：死亡后自动走回（一键版，无需脚本）
- 新增行为设置 `settings.returnOnDeath: boolean`（与 `allowDig`/`respawnCommand` 同层）。
- `bot.on('respawn')`：若 `returnOnDeath` 且有 `_deathPos` → **延迟**（先让 `respawnCommand` 跑完，如 2.5s）后用现有带超时的寻路（参考 `gotoWithTimeout`/`return_home` 写法）走回 `_deathPos`；走不到/超时安全放弃并记日志，不卡死。
- 与 `respawnCommand` 组合：命令先（把 bot 从主城弄到大概区域）→ 再走回死亡点。两开关独立，可单开可组合。

### 3. 脚本可用死亡点（复杂返回：选副本等）
- 在 `respawn` 触发器脚本运行时，注入变量 `$deathX` / `$deathY` / `$deathZ`（接入 script_engine 现有变量插值系统）。
- 脚本即可：`cmd /spawn` → `find_and_click_slot`（选副本菜单）→ `goto $deathX $deathY $deathZ`（传送进副本后走最后一段）。
- 不新增步骤类型（用现有 `goto` + 变量插值即可），降低改动面。

## 数据流
```
存活中: updateStatus 每2s → this._lastAlivePos = entity.position
死亡: bot.on('death') → this._deathPos = this._lastAlivePos → 日志
重生: bot.on('respawn') →
  ├─ respawnCommand（已有，1.5s）发命令
  ├─ returnOnDeath 开 → 延迟后 gotoWithTimeout(_deathPos)
  └─ respawn 触发器脚本（已有）→ 注入 $deathX/Y/Z → 用户脚本自定义
```

## 错误处理
- `_deathPos` 为空（从未存活/刚连）→ 跳过自动返回，不报错。
- 寻路失败/超时 → 安全放弃 + 一条日志，不影响挂机。
- 模组服寻路 varint 失败 → **本期不优化**（已与用户确认）；命令/选副本脚本路径不受影响。
- returnOnDeath 与脚本 respawn 触发器都开时各跑各的（用户自负责不冲突）。

## 改动文件
- `packages/engine/src/BotInstance.js`：`_lastAlivePos` 跟踪、`_deathPos` 捕获、respawn 自动返回。
- `packages/engine/src/api/moduleHandlers.ts`：`behavior:get` 返回 + `behavior:setReturnOnDeath`（或并入现有 behavior 写入）含 `returnOnDeath`。
- `packages/engine/src/botManager.ts`：settings 白名单 `sanitizeSettingsPatch` 加 `returnOnDeath`（布尔）。
- `packages/engine/src/modules/script_engine.js`：respawn 触发器脚本注入 `$deathX/Y/Z` 变量。
- `packages/protocol/src/index.ts`：`BotSettings.returnOnDeath?: boolean`。
- `packages/ui/src/features/bot/ModulesTab.tsx`：「行为设置」卡加开关「死亡后返回原位（自动走回死亡点）」。

## 验证
- 连 mcly（vanilla 类、寻路可用）：挂机 → 杀死 → 重生 → 开了 returnOnDeath 则自动走回死亡点附近；日志有「已记录死亡点 / 正在返回」。
- 脚本：建一个 respawn 触发器脚本用 `$deathX/Y/Z` 做 `goto`，确认变量插值正确。
- 关闭开关 → 死后不返回（行为如旧）。

## 不做（本期）
- 模组服寻路返回的可靠性（varint）——延后。
- 死亡点持久化到磁盘——无必要（连接级即可）。
- 独立的「死亡返回」配置模块（方案 B）——避免重造脚本引擎。
