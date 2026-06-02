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

## 2. 行动：提交脚本（保存并运行）

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

## 3. 脚本规范

```jsonc
{
  "name": "示例", "loop": false, "loopDelay": 0,
  "trigger": { "type": "manual" },
  "steps": [ { "do": "chat", "msg": "你好" }, { "do": "wait", "s": 2 } ]
}
```

- **步骤 `do`**：`chat(msg)` `cmd(cmd)` `whisper(player,msg)` `wait(s)` `log(msg)` `goto(x,y,z)` `goto_location(name)` `return_home` `equip(item)` `equip_best_weapon` `drop(item,count)` `use_item` `attack(entity)` `jump` `swap_hands` `look(x,y,z)` `if(cond,steps)` `repeat(times,steps)` `while(cond,steps)` `break_if(cond)` `run_script(name)` `stop` `set_var(name,value)` `math_var(name,op,value)` `note(text)`
- **触发 `trigger.type`**：`manual` `interval(value=秒)` `schedule(value=HH:MM)` `chat_match(value=关键词)` `health_below(value=数)` `respawn` `player_nearby` `inventory_full`
- **条件 `cond`**（用于 if/while/break_if）：`health < 10`、`food < 5`、`inventory_full`、`inventory_has diamond`、`inventory_count diamond > 10`、`players_nearby`、`no_players_nearby`、`holding diamond_sword`、`alive`、`dead`、`var counter > 5`

## 4. 无 API Key 用法（客户端）

机器人详情页「AI」标签 → 「复制 AI 提示词」→ 粘到 Claude/任意 AI，在末尾写下目标 →
AI 返回脚本 JSON → 到「脚本」标签粘贴运行。提示词已自动带上当前世界状态与脚本规范。

## 5. 程序化用法（LLM 函数调用）

把下面两个函数注册给你的 LLM（OpenAI/Anthropic function calling 均可）：

```json
[
  {
    "name": "observe_bot",
    "description": "获取 Minecraft 机器人当前可感知的世界状态",
    "parameters": { "type": "object", "properties": { "botId": { "type": "string" } }, "required": ["botId"] }
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

`observe_bot` → `GET /api/observe/:botId`；`run_script` → `POST /api/ai/script/:botId`。

**建议系统提示**：
> 你是 Minecraft 挂机机器人的操控助手。先调用 observe_bot 了解现状，再根据用户目标生成符合规范的脚本，用 run_script 执行。脚本只用文档列出的 do/trigger/cond。动作要安全、可中断。
