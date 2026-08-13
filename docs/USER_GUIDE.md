# 使用指南

面向玩家的 Minecraft 挂机机器人。引擎 7×24 跑在常开主机（Docker），用桌面 / 手机客户端遥控。

## 一、部署引擎（一次性）

在一台 7×24 常开的主机（VPS 或家用小主机）上：

```bash
git clone <repo> && cd SteveDeck
docker compose -f docker/docker-compose.yml up -d --build
docker logs stevedeck-engine     # 记下「访问令牌」和「连接串」
```

启动日志示例：
```
================ SteveDeck 引擎已启动 ================
访问令牌: db5282b4fe2f4bb6...
连接串: mcbot://1.2.3.4:8723?token=db5282b4fe2f4bb6...
```

> 安全：公网部署务必走反向代理加 TLS（见 `docker/README.md`），并使用自动生成的强令牌。
>
> 家里主机跑引擎、在 NAT 后面想用手机在外网遥控？见 [远程访问 / 内网穿透](REMOTE_ACCESS.md)。

## 二、连接客户端

1. 打开桌面 / 手机客户端。
2. 在「连接到你的引擎」页：
   - **桌面**：把连接串粘到「引擎地址 / 连接串」框（令牌会自动带入），点连接；或分别填地址与令牌。
   - **手机**：扫描引擎二维码（`GET /api/connection-info` 返回）自动填入。
3. 连接成功后进入主界面，连接信息会被记住，下次自动连。

## 三、添加与管理机器人

- 左侧栏点 **+** → 填 用户名（MC 登录名）/ 服务器地址 / 端口 / 版本 /（可选）登录密码 → 添加并连接。
- 选中机器人后，详情面板：
  - **概览**：在线状态、生命/饱食/等级/坐标、计分板查看。
  - **模块**：自动战斗 / 钓鱼 / 挖矿 / 农场 / 追怪 / 跟随 / 垃圾清理 / 自动使用 / 定时广告（循环喊话）/ 盯人监听（记录指定玩家的相关聊天）的开关与「配置」。每个模块运行时显示「当前活动」状态行——在干什么、为什么没动作一眼可见。
  - **地点**：保存当前坐标、一键前往。
  - **定时**：设定时刻自动发送命令（如定时 `/home`）。
  - **日志**：实时服务器消息。
  - 底部聊天栏：发送聊天或命令（如 `/login`、`/home`）。
- 顶部按钮：重连 / 停止 / 删除。

## 四、挂机通知推送（出事推到手机）

人不在电脑前时，机器人**死亡 / 被踢出 / 掉线（放弃重连）/ 盯人命中**（盯人监听模块开启推送后）可经 Webhook 推送到手机：

1. 打开客户端右上角 **设置 → 挂机通知推送**，打开开关。
2. 选择渠道预设并粘贴对应的 Webhook 地址：
   - **Server酱**（微信接收，个人最简单）：`https://sctapi.ftqq.com/<SendKey>.send`
   - **钉钉 / 飞书 / 企业微信** 群机器人：各自群设置里创建机器人得到的地址。钉钉若选了「自定义关键词」安全设置，把关键词填 `SteveDeck`。
   - **Bark**（iOS）：`https://api.day.app/<你的Key>`
   - **Discord Webhook** 或 **通用 JSON POST**（自建接收端 / n8n / Home Assistant）。
3. 勾选要推送的事件 → **保存** → 点 **测试** 确认手机能收到。

同一机器人的同类事件默认 60 秒内只推一次，不怕死亡循环刷屏。配置存在引擎端（`data/notify.json`），
桌面/手机客户端共享同一份，配一次全端生效。

## 五、脚本（自动化编排）

「脚本」标签页可视化编排机器人行为：一切皆步骤（与 AI 生成、录制回放同构），支持循环、条件、变量、子脚本与触发器。

### 常用动作（按类）

| 类别 | 动作 |
|---|---|
| 移动 | `goto`（坐标/实体）· `goto_location`（保存地点，完整到达链）· `goto_nearest` · `return_home`（优先名为「家/home」的地点） |
| 聊天 | `chat` · `cmd` · `whisper` · `wait_chat`（等消息，支持正则捕获存变量） |
| 界面 | `interact`（右键实体开菜单）· `click_slot` · `find_and_click_slot`（按名字/lore 找格子）· `wait_gui_item` · `close_gui` |
| 物品 | `equip` · `equip_best_weapon` · `equip_best_tool` · `deposit`（存箱，可配合地点）· `drop` · `drop_all`（保留关键词）· `use_item` · `craft` |
| 世界 | `dig`（找→走近→换工具→挖）· `place` · `attack`（≤6 格内目标）· `look` / `look_at` |
| 流程 | `wait` · `wait_until`（等条件）· `wait_spawn` · `set_var` · `math_var` · `log` · `stop` · `run_script`（子脚本带参数） |

### 条件语法（if / while / break_if / wait_until 通用）

- 数值：`health<10` `food>=6`（支持 `< > <= >=`）
- 背包：`inventory_full` · `inventory_has 钻石` · `inventory_count 圆石>=64`
- 状态：`alive` / `dead` · `holding 剑` · `players_nearby` / `no_players_nearby`
- 界面：`gui_open` / `gui_closed` · `gui_has 下一页` · `gui_slot_has 13 确认`
- 变量：`var counter>=5` · `var mode==auto`（`==`/`!=` 按字符串宽松比较）
- 组合：`&&`（且）`||`（或）`!`（非）与括号，如 `health<10 && !gui_open`

### 变量

- 步骤里所有文本字段支持 `{变量名}` 插值；未赋值的变量原样显示（便于发现拼写错）。
- `set_var` 特殊取值：`$health` `$food` `$x/$y/$z`（当前坐标）、`$scoreboard:关键词`（计分板取数）、`=1+2*3`（安全数学表达式，只允许数字与运算符）。
- 死亡后自动写入 `{deathX}/{deathY}/{deathZ}`（死亡点坐标）。

### 触发器（脚本自动启动）

| 类型 | 说明 |
|---|---|
| `manual` | 只手动启动（默认） |
| `schedule` | 每天到点触发一次（HH:MM，当天去重） |
| `interval` | 每 N 秒触发 |
| `chat_match` | 聊天包含指定文本（3 秒内消费一次） |
| `health_below` / `food_below` | 低于阈值 |
| `damage` / `respawn` | 受伤 / 重生后 |
| `mob_nearby` / `player_nearby` | 敌对生物 / 玩家靠近 |
| `inventory_full` | 背包满 |

同一时刻只跑一个脚本；`health_below` 与 `damage` 是**保命触发器**，可抢占正在运行的普通脚本（保命脚本自身不被抢占）。

### 控制流语义要点（容易踩的坑）

- `repeat` 的 `times=0` 表示**无限循环**（配合循环脚本用；空的无限块会被拦截）；整个脚本有 10 万步熔断兜底。
- `while` 需要 `cond`，默认最多 10000 轮（可用 `max` 调整）。
- `break_if` 跳出的是**最近一层步骤序列**：写在循环体里的效果是「跳过本轮剩余步骤进入下一轮」（continue 语义）；要提前结束循环请用 `while` 的条件。
- 任何叶子动作可加 `cond`（不满足则跳过该步）与 `retry`/`retryDelay`（失败自动重试 N 次）。
- 循环脚本（loop 开）手动启动后会记住：断线重连自动续跑。

## 六、常见问题

- **一直「重连中」**：检查服务器地址/端口/版本是否正确；查看「日志」里的踢出原因。
- **连不上引擎**：确认地址可达、令牌正确、（公网）端口已放行。
- **正版登录**：当前以离线(offline)为主；微软正版登录为后续支持项。
