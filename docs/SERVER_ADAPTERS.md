# 服务器扩展边界

核心框架不写服务器地址、账号名单、菜单贴图映射、副本坐标或掉落规则。具体服务器功能集中在 `packages/engine/src/adapters/<server>` 与 `packages/ui/src/adapters/<server>`；独立运维脚本继续位于 `tools/<server>`。

`adapters/index` 是显式的扩展装配入口。引擎核心只通过注册表 `getServerAdapter(config)` 获取可选扩展；UI 根据通用 `BotSummary.serverAdapter` 元数据选择 UI 扩展，公共协议没有某个服务器专用开关。

当前扩展接口：

| 接口 | 用途 |
|---|---|
| `matches(config)` | 同时匹配服务器地址和端口 |
| `summary(config)` | 提供适配标识、菜单能力和默认日志视图 |
| `dragonCore` | 静态协议配置、按键、贴图文字、界面标题及快捷入口 |
| `menuAction(key)` | 解析该服特殊业务入口，未匹配时不介入 |
| `installFishing(inst)` | 安装该服钓鱼模式，原版钓鱼由核心提供 |
| `createMonitor(inst, callbacks)` | 提供消息分类、报告附加、保存、重置和清理生命周期 |
| `combatPolicy(inst)` | 可选的攻击就绪条件、目标过滤与等待说明 |
| `npcPolicy` | 可选的 NPC 名称处理及真人排除策略 |
| `hunterConfig(inst, config)` | 将该服旧控制参数映射为通用追怪策略 |

可吸收进框架的经验包括共享协议解码、连接世代隔离、可取消等待、物品快照校验、通用单目标选择及扩展生命周期；具体服务器玩法留在适配包。

公开版本的引擎与 UI 注册表默认为空。部署方显式注册独立适配包：引擎调用 `registerAdapter`，UI 调用 `registerServerUiAdapter`。`adapters/local/` 被 Git 忽略；本地运行记录、账号配置和业务脚本不参与框架发布。不要将个人适配入口提交到公共仓库。

`packages/engine/test/serverAdapters.test.cjs` 检查默认不绑定服务器、注册校验和端点隔离。
