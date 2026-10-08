# 龙核心适配与开发

当前实现的协议是 **Minecraft 1.12.2 / DragonCore 2.4.71**，VexView 菜单支持需由独立适配包显式配置。它不是龙核心客户端渲染器，也不会解释或执行服务器 YAML 中的函数、表达式和脚本。

## 分层

- `modules/dragoncore_codec.js`：下行 gzip、分片及配置/按键/槽位/界面解码；上行按键和事件编码。
- `modules/dragoncore/runtime.js`：每个连接一个接收器，共享解码结果、配置缓存、界面版本及可取消等待。不同账号和重连后的新连接隔离。
- `modules/dragoncore/profiles.js`：通用协议配置校验和端点绑定。具体服务器的按键、VexView 版本和贴图文字映射由独立适配包提供，协议层不写服务器地址。
- `mod_menu_key.js` / `mod_menu_items.js`：读取面板、按钮、命名槽位和鼠标物品；沿用菜单 token、物品指纹、槽位回执和拒绝交易不自动重试的规则。
- `scriptActions/mod_gui.js` 与 UI `cmd.dragoncore`：脚本和前端共用底层，不再各自拼包。

所有连接默认只被动接收 `dragoncore:main`；未配置的服务器不会自动注册该通道、发送按键。公开版本不内置具体服务器适配，所有端点需显式开启并绑定协议，绑定记录包含 host/port，改服务器后失效。

`opcode=100` 同时承载开关界面和组件更新表达式；只有 `opengui` / `closegui` 改变界面生命周期，其他内容只记诊断摘要。`inspect.errors` 是当前接收器的错误数，`historicalErrors` 单独保留此前观察器的历史计数。

## 开发接口

统一通过已认证的 `module:action` 调用，参数为 `{id, module:"dragoncore", action, args}`：

| action | args | 用途 |
|---|---|---|
| `inspect` | 无 | 协议、已收到按键、配置名、槽位标识、当前界面及错误计数 |
| `config` | `{name:"Gui/某界面.yml"}` | 读取已下发配置原文，不读取服务器磁盘文件 |
| `configure` | `{enabled:true,keys:["T","R"]}` | 显式启用当前端点；keys 是人工确认的按键绑定，空列表仅允许服务器下发的绑定 |
| `key` | `{key:"T"}` | 仅发按键，返回 `afterRevision`；`sent` 不代表界面已打开 |
| `waitGui` | `{name:"某界面",afterRevision,timeoutMs:4000}` | 等待指定名字的新 `opengui` 回包；name 不含 `Gui/` 和 `.yml` |
| `open` | `{key:"T"}` | 发按键并读取面板；返回现有 menu/window 结构 |
| `click` | `{token,buttonId}` 或 `{token,slotKey,mouse:0}` | 操作快照中已识别按钮/已读取槽位 |
| `refresh` | `{token}` | 重新读取自定义槽位 |

`configure` 写入机器人设置 `dragonCore`。关闭时传 `{enabled:false}`。本协议尚未验证其他 Minecraft/DragonCore 版本，不应只改版本字符串就声称兼容。

前端已有类型化入口：

```ts
const info = await cmd.dragoncore.inspect(botId);
const config = await cmd.dragoncore.config(botId, info.configs[0].name);
const sent = await cmd.dragoncore.key(botId, "T");
await cmd.dragoncore.waitGui(botId, "实际配置中的界面名", sent.afterRevision);
```

`key` 不猜测对应聊天指令；`waitGui` 可确认已经下发界面，但不生成可点击的菜单快照。需要后续按钮/槽位交互时使用 `open` 或脚本 `mod_key`。VexView T 主菜单与 DragonCore 子界面可能是混合流程，返回值的 `provider` 才是实际界面类型。

## 可视化脚本

脚本编辑器已提供“打开模组菜单”“点击模组按钮或槽位”“刷新模组槽位”步骤。示例只打开已配置的菜单，未包含兑换、购买或物品转移：

```json
{
  "name": "自定义菜单入口",
  "server": "mc.example.test",
  "loop": false,
  "trigger": {"type": "manual"},
  "steps": [
    {"do":"mod_key","provider":"dragoncore","key":"T"},
    {"do":"mod_click","label":"副菜单"}
  ]
}
```

`mod_click` 精确匹配唯一按钮，或者使用已读取的 `slotKey`；不根据文件名或位置猜测行为。脚本上下文保存单次菜单 token，失败后不自动重复点击。原版箱子界面继续用 `wait_gui_item` / `find_and_click_slot`，不能把龙核心命名槽位当作箱子槽位编号。

## 新服务器/新界面的适配顺序

1. 被动检查 `inspect` 的实际配置、按键、界面及槽位，再用 `config` 阅读原文。
2. 确认与当前支持的线协议一致，再启用当前端点。需要新的 VexView 版本或特殊菜单映射时，在独立的 `adapters/<server>` 包中添加适配，并在扩展装配入口注册；不要改公共编解码器或核心模块。
3. 通用静态解析器只识别有限的命名物品槽和静态文字。动态文本、输入框、龙核心函数型按钮等不保证可以交互；无法确认动作的组件保持不可点击。新增动作应写显式适配并复用快照检查，不直接执行下发脚本。
4. 先读取菜单和实际回执验证，再开发业务脚本。发包成功、收到界面、物品交易到账是三个不同状态。

基础接收与已有按键协议不依赖新增 Node 原生模块。自定义 JS 仍默认关闭。
