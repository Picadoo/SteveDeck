# 录制玩家操作 → 可编辑脚本 + 视角踩点（设计）

日期：2026-06-06

## 目标与定位

降低写脚本门槛：让玩家**做一遍**就能得到脚本，而不是手搓积木。核心架构思想——

> **一切皆「脚本步骤」**。手搓积木 / AI 生成 / 录制回放——三种来源，产出**同一种 `steps[]`**，在**同一个脚本编辑器**里编辑。

这是统一架构，不是三套小作坊。本 spec 落地「录制」与「踩点」；AI 助手是后续阶段（见末尾）。

## 范围

**v1 做：**
- **操作录制**：开录制会话，把玩家在 app 里发起的命令按时序映射成 `steps[]`，停止后存为草稿脚本、直接进编辑器改。
- **踩点**：实时视角里加「获取当前位置」按钮，捕获机器人当前坐标；录制中→插 `goto x,y,z`，未录制→复制坐标/可存地点。

**v1 不做：**
- ❌ 自动移动路径录制（手动操控不精细，录出来是噪声）——用「踩点」代替。
- ❌ 应用内 AI 助手（后续阶段）。

## 命令 → 步骤 映射

录制的是**玩家发起的命令**（不是机器人自动行为）。映射表：

| 命令（引擎入口） | 录成步骤 | 备注 |
|---|---|---|
| `BOT_CHAT`（不以 `/` 开头） | `chat {msg}` | |
| `BOT_CHAT`（以 `/` 开头） | `cmd {cmd}` | |
| `BOT_GOTO` / `move:goto` | `goto {x,y,z}` | |
| `location:goto` | `goto_location {name}` | |
| `inventory:use` | `use_item`（先 `equip {item}` 拿到手） | 按**物品名**，不按槽位 |
| `inventory:equip` / `inventory:hold` | `equip {item}` | |
| `inventory:drop` | `drop {item,count}` | |
| `window:click` | `find_and_click_slot {item,button,matchLore}` | **按点中槽位的物品显示名**录，不按死槽位号 |
| `window:close` | `close_gui` | |
| 踩点按钮 | `goto {x,y,z}` | 见下 |
| `move:control` / `move:turn` | （不录） | 移动/转视角是噪声 |

**让录制结果「耐用」的三决策：**
1. **按名字、不按硬坐标/槽位**：GUI 点击录成「找『强化石』点击」(`find_and_click_slot`)，换服/界面刷新照样跑。
2. **自动补等待**：相邻操作间隔 > 0.8s 自动插 `wait`；`inventory:use` 打开界面后自动插 `wait_gui_item`（用刚点的物品名做线索），回放不会快到服务器跟不上。
3. **可编辑草稿、非黑盒**：录完是 `steps[]`，用户改坐标、包 `repeat`、加 `if`。

## 架构

### 引擎
- `BotInstance` 加 `recorder = { active, steps: [], startedAt, lastAt }`。
- 方法：`startRecording()` / `stopRecording()→steps[]` / `recordingStatus()`。
- `recordStep(step)`：push + 自动补 `wait`（按 `lastAt` 间隔）+ 通过 `MODULE_STATE` 事件回传 `{active, count, last}`。
- **拦截点**：在命令入口集中调用 `inst.recorder?.note(kind, args, inst)`：
  - `handlers.ts`：`BOT_CHAT` / `BOT_GOTO` 处。
  - `moduleHandlers.ts`：`MODULE_ACTION` 里对 `inventory:* / window:click / window:close / location:goto / move:goto` 这几个 case 调用。
- 映射函数 `stepFromCommand(kind, args, inst)`：纯函数 + 个别需读实时状态（`window:click` 读 `bot.currentWindow.slots[slot]` 拿物品名）。

### 协议
- 复用 `module:action`：`recording:start` / `recording:stop`（返回 `{steps}`）/ `recording:status`。不新增顶层命令。
- 复用 `ServerEvents.MODULE_STATE`：`{id, module:"recording", state:{active,count,last}}` 实时刷录制条，无需新事件。

### UI
- **「脚本」页**：加「🔴 录制」按钮。录制态显示红条「正在录制… N 步」+ 停止。停止 → 命名/分类对话框 → 复用现有脚本保存 → 打开 `ScriptEditor` 编辑草稿。
- **实时视角（Viewer）**：加「📍 获取当前位置」按钮：
  - 录制中：`recording:note` 一条 `goto {当前坐标}`，toast「已踩点 → x,y,z」。
  - 未录制：复制坐标到剪贴板 + toast（可粘到 goto 步骤 / 地点）。
  - 坐标来源：机器人快照 `pos`（goto 容差足够）。

## 验证
- 本地花果山：开录制 → 发消息、走到坐标、用菜单物品、点界面格、关界面、踩点 → 停止 → 检查生成的 `steps[]` 顺序与映射正确、GUI 点击为按名、间隔有 `wait`。
- 草稿能在编辑器打开并改、能运行。

## 后续阶段（不在本 spec）
- **AI 助手（应用内）**：BYOK + 兼容 OpenAI 接口（DeepSeek/Kimi/智谱/Ollama/OpenAI），把 `observation + manifest + 需求` 喂模型 → 产出 `steps[]` → 编辑器过目再跑。
- **能力清单 manifest**：观测字段 + 步骤目录 + 已探查的服务器定制菜单，AI/外部 agent 自描述入口。
- 对外 REST/manifest 保留给开发者；产品主线是应用内助手。
