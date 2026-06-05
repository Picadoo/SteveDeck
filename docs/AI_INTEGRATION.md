# AI 接口：让 AI 感知服务器并写脚本

引擎提供一组接口，让任意 AI（Claude / GPT / 本地模型）**感知机器人当前世界状态**，并据此**生成脚本并运行**。无需任何 API Key 也能用（客户端「AI」标签一键复制提示词给 AI）。

所有接口都需要令牌鉴权：HTTP 加 `Authorization: Bearer <令牌>`，WebSocket 握手带 `auth.token`。

---

## 1. 感知：获取世界状态

**HTTP**：`GET /api/observe/:botId`
**WebSocket**：`emit("ai:observe", { id })`，ack 返回 `{ ok, data: Observation }`

返回 `Observation`：

```jsonc
{
  "bot": { "id": "...", "username": "MyBot", "host": "mc.x.com", "online": true },
  "self": {
    "pos": { "x": 100, "y": 64, "z": -200 },
    "health": 20, "food": 18, "xpLevel": 7,
    "heldItem": "diamond_sword",
    "yaw": 1.2, "pitch": 0.0,
    "dimension": "minecraft:overworld", "gameMode": "survival"
  },
  "inventory": [ { "name": "cobblestone", "count": 64, "displayName": "Cobblestone" } ],
  "nearbyPlayers": [ { "name": "Steve", "distance": 5.3, "pos": { "x": 104, "y": 64, "z": -198 } } ],
  "nearbyEntities": [ { "type": "mob", "name": "zombie", "distance": 8.1, "pos": {...} } ],
  "recentChat": [ "<Steve> hi", "你被 zombie 攻击了" ],
  "modules": { "combat": false, "fishing": false, "automine": false, "autofarm": false, "mobhunter": false, "runningScript": null },
  "savedLocations": [ { "id": "...", "name": "家", "x": 0, "y": 64, "z": 0 } ],
  "scoreboard": { /* 可选 */ }
}
```

`self` 为 `null` 表示机器人离线。

## 2. 探索：探明服务器定制菜单（写 GUI 脚本的关键）

RPG 服大量功能藏在「右键某物品打开的 GUI 菜单」里，且每个服务器的物品名/结构都不同。
**探索接口让 AI 主动开菜单、把里面有什么探明白**，再据此写脚本——不用人肉报菜单内容。

**HTTP**：`POST /api/explore/:botId`，body：

```jsonc
{
  "item": "自助菜单",                          // 背包里要用的物品(按显示名关键词匹配)；不传则返回背包候选
  "clickPath": ["副本菜单", "金币经验副本"]    // 可选：开菜单后逐级点进子菜单(按 名字/lore 关键词)
}
```

返回（探完自动关闭菜单，不会一直占着界面）：

```jsonc
{
  "usedItem": "自助菜单",
  "trail": [ { "keyword": "副本菜单", "slot": 13 } ],          // 下钻路径
  "window": {
    "title": "默认界面", "slotCount": 90,
    "slots": [ { "slot": 7, "name": "金币经验副本", "id": "paper",
                 "lore": "传送到金币经验副本\n可获得大量经验和金币" } ]
  }
}
```

- 不传 `item` → 返回 `{ candidates: [{slot,id,name,count}] }`（背包里有自定义名的物品，作为探查候选）。
- **典型用法**：AI 想做「每天领在线奖励」→ 先 `explore {item:"自助菜单"}` 看有哪些项 → 发现「在线奖励领取」→ 再 `explore {item:"自助菜单", clickPath:["在线奖励"]}` 看子菜单可领项 → 据此写脚本。

## 3. 行动：提交脚本（保存并运行）

**HTTP**：`POST /api/ai/script/:botId`，body：

```jsonc
{
  "script": { "name": "去家挂机", "loop": false, "trigger": { "type": "manual" },
              "steps": [ { "do": "return_home" }, { "do": "chat", "msg": "/afk" } ] },
  "run": true   // 默认 true：保存后立即在该机器人上运行
}
```

返回 `{ ok: true, saved: "<脚本名>", started: true|false }`。

WebSocket 等价：`script:save` + `script:start`（见各命令）。

## 4. 脚本规范

```jsonc
{
  "name": "示例", "loop": false, "loopDelay": 0,
  "trigger": { "type": "manual" },
  "steps": [ { "do": "chat", "msg": "你好" }, { "do": "wait", "s": 2 } ]
}
```

- **动作**：`chat(msg)` `cmd(cmd)` `whisper(player,msg)` `goto(x,y,z)` `goto_location(name)` `return_home` `equip(item)`（按**显示名或物品ID**找并持到手） `equip_best_weapon` `drop(item,count)` `use_item`（右键手持物，常用于打开菜单） `attack(entity)` `jump` `swap_hands` `look(x,y,z)`
- **GUI 界面交互**（服务器定制菜单）：`use_item`（开菜单）→ `wait_gui_item(item, timeout?, matchLore?)`（等界面出现含关键词的物品，按**显示名**匹配）→ `find_and_click_slot(item, button?, matchLore?, slotFrom?, slotTo?, save_slot?)`（按**名字/lore**找槽位点击，button 0=左键/1=右键）→ `click_slot(slot, button?)` → `close_gui`
- **等待/变量/流程**：`wait(s)` `wait_chat(pattern, timeout?, regex?, save_to?)` `wait_until(cond, timeout?)` `set_var(name, value)`（value 可用 `$health/$food/$x/$y/$z/$scoreboard:关键词`） `math_var(name, op, value)` `if(cond, steps[, else])` `repeat(times, steps)` `while(cond, steps)` `break_if(cond)` `run_script(name)` `stop` `log(msg)` `note(text)`
- **触发 `trigger.type`**：`manual` `interval(value=秒)` `schedule(value=HH:MM)` `chat_match(value=关键词)` `health_below(value=数)` `respawn` `player_nearby` `inventory_full`
- **条件 `cond`**（用于 if/while/break_if）：`health < 10`、`food < 5`、`inventory_full`、`inventory_has diamond`、`inventory_count diamond > 10`、`players_nearby`、`no_players_nearby`、`holding diamond_sword`、`alive`、`dead`、`var counter > 5`

### GUI 自动化套路（开菜单 → 逐级找物品点击）

先用「探索接口」探明菜单里的物品名（关键词用**显示名/lore**，不是物品 id），再照此写：

```jsonc
{ "name": "刷金币经验副本", "trigger": { "type": "manual" }, "steps": [
  { "do": "equip", "item": "自助菜单" }, { "do": "use_item" },
  { "do": "wait_gui_item", "item": "副本菜单", "timeout": 8 },
  { "do": "find_and_click_slot", "item": "副本菜单" },
  { "do": "wait_gui_item", "item": "金币经验副本", "timeout": 8 },
  { "do": "find_and_click_slot", "item": "金币经验副本" },
  { "do": "wait", "s": 2 }
]}
```

要点：① 每次点击换菜单后，用 `wait_gui_item` 等下一级目标物品出现再点；② 领奖类「可领取/已领取」常写在 lore 里，`find_and_click_slot` 设 `matchLore:true` 按 lore 区分。

## 5. 无 API Key 用法（客户端）

机器人详情页「AI」标签 → 「复制 AI 提示词」→ 粘到 Claude/任意 AI，在末尾写下目标 →
AI 返回脚本 JSON → 到「脚本」标签粘贴运行。提示词已自动带上当前世界状态与脚本规范。

## 6. 程序化用法（LLM 函数调用）

把下面两个函数注册给你的 LLM（OpenAI/Anthropic function calling 均可）：

```json
[
  {
    "name": "observe_bot",
    "description": "获取 Minecraft 机器人当前可感知的世界状态",
    "parameters": { "type": "object", "properties": { "botId": { "type": "string" } }, "required": ["botId"] }
  },
  {
    "name": "explore_menu",
    "description": "用背包里某物品打开服务器定制 GUI 菜单，抓取里面所有物品(名字/lore/槽位)后关闭；可选 clickPath 逐级点进子菜单。用于搞清菜单结构以便写脚本",
    "parameters": { "type": "object", "properties": { "botId": { "type": "string" }, "item": { "type": "string", "description": "背包物品显示名关键词" }, "clickPath": { "type": "array", "items": { "type": "string" }, "description": "可选：逐级点进子菜单的关键词" } }, "required": ["botId"] }
  },
  {
    "name": "run_script",
    "description": "在机器人上保存并运行一个脚本（脚本格式见 mc-bot-player 文档）",
    "parameters": {
      "type": "object",
      "properties": {
        "botId": { "type": "string" },
        "script": { "type": "object", "description": "{name, loop, trigger, steps}" }
      },
      "required": ["botId", "script"]
    }
  }
]
```

`observe_bot` → `GET /api/observe/:botId`；`explore_menu` → `POST /api/explore/:botId`；`run_script` → `POST /api/ai/script/:botId`。

**建议系统提示**：
> 你是 Minecraft 挂机机器人的操控助手。先 observe_bot 了解现状；涉及服务器定制菜单(领奖/副本/商店等)时，先用 explore_menu 探明菜单结构(物品按显示名)，再生成符合规范的脚本用 run_script 执行。GUI 步骤的关键词一律用**显示名/lore**(不是物品 id)。动作要安全、可中断。

## 7. 接哪个 AI？（通用协议，便宜/贵都能用）

本接口**不绑定任何 AI 厂商**。推荐用 **OpenAI 兼容协议**对接，便宜的和贵的都行：

| 提供方 | Base URL（`/chat/completions`） |
|---|---|
| DeepSeek（便宜） | `https://api.deepseek.com/v1` |
| OpenAI | `https://api.openai.com/v1` |
| 本地 Ollama（免费） | `http://localhost:11434/v1` |
| 其它（Qwen / Moonshot / 硅基流动…） | 各自的 OpenAI 兼容地址 |

把 `observe_bot` / `run_script` 注册为 tools，模型即可自主「看世界 → 写脚本 → 运行」。

> **最省事（无需任何 API Key）**：客户端「AI」标签 →「复制 AI 提示词」→ 粘到任意 AI 对话框（网页版 DeepSeek / Claude / ChatGPT 均可）→ 把返回的脚本 JSON 贴到「脚本」页运行。不是人人都有 API，这条路对所有人都通。
