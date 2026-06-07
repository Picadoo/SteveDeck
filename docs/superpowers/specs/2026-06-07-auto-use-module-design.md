# 自动使用（auto-use）模块 — 设计

- **日期**：2026-06-07
- **状态**：已与用户确认设计，待写实现计划
- **关联**：替代 `2026-06-07-feature-completeness-review.md` 里原 [ENG-2]「自动进食/保命」；缺陷向见 `2026-06-07-code-review.md`

---

## 1. 背景与目标

起点是「自动进食」，但进食只是「在某条件下使用某物品」的一个特例：服务器里还有 shift+右键、右键空气触发的自定义道具、喝奶解 debuff、定时用钥匙/活动道具……本质都是 **条件 → 使用物品**。

**目标**：做一个**通用的「自动使用」模块**，常驻后台，按用户配置的规则「触发条件 → 找到物品 → 使用」。`auto-eat` 只是一条**内置默认规则**。

**核心原则**：模块**不内置任何物品语义**（不知道「奶能解 debuff」），只提供通用机制；用什么物品、什么条件，**玩家自己配**。

**非目标（YAGNI）**：
- 不做优先级配置（用一个 `bodyBusy` 标志即可）。
- 不做事件/聊天触发（脚本系统的 `chat_match` 已覆盖，不重复）。
- 不做中央动作调度器（过度设计）。
- 模块不替玩家判断「该用什么」。

---

## 2. 为什么是模块，不是脚本

- 脚本系统是「单运行槽 + 顺序过程」——一次只能跑一个，为完成一段流程。
- 自动使用是「常驻反射」——要和战斗/挖矿/农场/甚至正在跑的脚本**同时**生效（边打边吃）。
- 所以做成**独立常驻模块**，复用现有模块骨架：`botInstance.xTask{active,config,timer}` + `toggleX` + `cleanupHooks` + `restoreModules`（与 `trash_cleaner.js` 同构）。

---

## 3. 核心模型：规则列表

```
rule = {
  id,               // 稳定 id
  enabled,          // 单条开关
  trigger,          // 何时触发（见 3.1）
  match,            // 用哪个物品（见 3.2）
  method,           // 怎么用（见 3.3）
  cooldownSec,      // 两次触发最小间隔（防刷）
}
```

模块维护 `rules[]`，一个评估循环（约每 1s）逐条检查：**规则启用 + 触发条件成立 + 冷却已过 + bot 存活且未 `bodyBusy`** → 执行一次「使用」。

### 3.1 触发器 trigger（v1 四种）

| 类型 | 参数 | 含义 |
|---|---|---|
| `food_below` | `value` | 饱食度 < value（auto-eat 用） |
| `health_below` | `value` | 血量 < value（回血/金苹果/喝奶） |
| `effect_missing` | `effect`, `minRemainSec?` | 缺某 buff（或剩余时间 < 阈值）→ 续 buff |
| `interval` | `everySec` | 每 N 秒（定时用钥匙/活动道具） |

> 触发器只读 bot 状态（`bot.food`、`bot.health`、`bot.entity.effects`），不内置物品语义。

### 3.2 物品匹配 match

| 方式 | 说明 |
|---|---|
| `name` | 物品 id（`golden_apple` / `milk_bucket` / 自定义 id） |
| `category` | 内置类别，目前仅 `food`=任意可食用（auto-eat 默认用它） |
| `displayName` | 显示名/Lore 含关键词（适配 RPG 自定义命名物品） |
| `slot`（可选） | 固定槽位 |

找不到匹配物品 → 跳过该次（限频日志，不刷屏）。

### 3.3 使用方式 method（复用 `useSlot` 分流 + 新增 sneak）

| 方式 | 实现 |
|---|---|
| `air`（默认） | 右键空气 `activateItem`（消耗品 + 右键空气触发的自定义物品） |
| `sneak_air` | **新增**：按住潜行 → `activateItem` → 松开（shift+右键） |
| `block` | 对脚下/面前方块（`placeBlock`/`activateBlock`） |
| `entity` | 对正前方生物（`activateEntity`） |

> 复用 `player_inventory.js` 的 `useSlot` 智能分流（装备到手 → 按物品类型分流到生物/方块/空气），抽成共享函数；自动使用在其前面加「按 match 找物品」、外面加 sneak 包装。

---

## 4. 协调机制：一个 `bodyBusy` 标志，零优先级

**问题**：bot 只有一具身体，下列状态全局共享——手持物品、控制键（含潜行）、视角、寻路目标、右键状态；而「吃东西要 ~1.6s 站定不被打断」。若不协调，会「吃饭吃一半被自己一刀打断」。

**方案**：在 `botInstance` 上加一个 `bodyBusy`（「忙到何时」的时间戳）。执行一次「使用」时：

1. `bodyBusy = now + ~1.8s`
2. 存下当前手持
3. （可选）按住 sneak
4. `equip` 匹配到的物品到手
5. 按 method 执行 `activateItem` / `activateEntity` / `placeBlock`
6. 等待完成（吃/喝约 1.6s）
7. `deactivateItem`、松开 sneak
8. **切回原手持**
9. 清 `bodyBusy`

**其它循环让位**：`combat` / `mob_hunter` / `automine` / `auto_farm` 的 tick 顶部加 `if (Date.now() < botInstance.bodyBusy) return;`；脚本引擎在「步与步之间」（已有中断检查处）加「等 `bodyBusy` 落下」。

- **没有优先级数字、没有每规则优先级。** 规则就一条：**正在用东西时，别人歇一拍。**
- **串行**：评估循环一次只发起一个「使用」，`bodyBusy` 天然互斥，规则之间不互抢。
- **诚实代价**（设计如此，非 bug）：触发时 bot 短暂停 ~1.6s 战斗/移动，用完即恢复；脚本在步间让一拍。寻路中途吃（长 `goto`）属边界情形：v1 优先在「非主动寻路/相对安全」时机触发，必要时的短暂打断由所属循环下一拍重走（combat/farm 本就反复重算路径）。

---

## 5. 默认规则：auto-eat

出厂自带一条**可编辑/可删**的默认规则，体现「auto-eat 只是 auto-use 的一条规则」：

```
{ trigger: food_below(17), match: category(food), method: air, cooldownSec: 2 }
```

---

## 6. 持久化与重连恢复

- `rules` 存 `settings.autoUse = { active, rules: [] }`，随 `bots.json` 落盘（走现有 `storage.ts` 原子写）。
- `restoreModules`（`BotInstance.js`）在重连/恢复时重新 `toggle` 开启。

---

## 7. 配置 / UI

- `ModulesTab` 加「自动使用」卡片（开关 + 进配置）。
- `ModuleConfigDialog` 做「规则列表」编辑：加/删/改每条（触发类型+阈值、物品匹配、使用方式、冷却、单条开关）。
- `moduleDefs.ts` 加模块定义；引擎走 `MODULE_TOGGLE` / `MODULE_CONFIG`；可选 `MODULE_ACTION` `autouse:test` 立即测一条规则。
- 复用现有字段渲染（number/select/tags/bool），**顺带补齐 `hint` 渲染**（一并改善 completeness 报告里的 UX-6）。

---

## 8. 与现有系统的边界

- **脚本**：保留单运行槽与全部触发器（含 `chat_match`）；自动使用不重复事件触发。脚本仍可做一次性「用物品」。
- **背包/useSlot**：把「智能使用」抽成共享函数，自动使用与现有手动 `useSlot` 共用，避免两套实现漂移。

---

## 9. 错误处理与资源清理（沿用现有契约）

- 评估循环 `interval` push 到 `botInstance.timers`；`cleanupHook`：清 interval、清 `bodyBusy`、切回手持、移除监听。
- 守卫：`bot.entity` 不在/死亡/未 spawn 时跳过；找不到物品静默跳过（限频日志）。
- `cooldown` map 以 `ruleId` 为键，规模有界（= 规则数）。
- 避免重蹈审查中的泄漏模式：定时器要追踪、**不要在每次 toggle 重复 push 到 `timers`**（参考 code-review 的 MODA-2）。

---

## 10. 测试要点

- **mock-bot 单测**：四种触发各自生效；冷却生效；找不到物品跳过；`bodyBusy` 互斥（用东西时其它 tick 让位）；用完切回原手持；stop/cleanup 清干净。
- **集成**：边战斗边吃——战斗让位、吃完恢复攻击；重连后规则恢复。

---

## 11. 落点（涉及文件）

- 新增 `packages/engine/src/modules/auto_use.js`
- 抽取/复用 `player_inventory.js` 的 `useSlot` 智能分流（导出为共享函数）
- `BotInstance.js`：`MODULE_NAMES` 注册 `auto_use`；`restoreModules` 加恢复；新增 `bodyBusy` 字段；在 `combat`/`mob_hunter`/`automine`/`auto_farm` tick 顶部加让位检查；`script_engine` 步间加让位
- `api/moduleHandlers.ts`：toggle/config（+ 可选 `autouse:test`）
- `packages/protocol/src/index.ts`：模块名/配置类型
- UI：`moduleDefs.ts` + `ModulesTab` 卡片 + `ModuleConfigDialog` 规则编辑器

---

## 12. 非目标 / YAGNI（再次明确）

- 无优先级配置（一个 `bodyBusy` 标志足够）。
- 无事件/聊天触发（脚本 `chat_match` 已有）。
- 模块不懂物品语义（玩家自己配「用什么」）。
- 不做中央动作调度器（过度设计）。
