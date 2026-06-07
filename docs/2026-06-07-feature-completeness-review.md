# mc-bot-player 功能完整度与改进建议审查（只读）

- **日期**：2026-06-07
- **性质**：这是上一份 [缺陷向审查 `2026-06-07-code-review.md`](2026-06-07-code-review.md)（内存泄漏/bug/竞态/安全）的**补充镜头**。本份**只谈功能完整度与产品/能力改进建议**，不重复缺陷条目。
- **方式**：4 个并行只读子代理分头审查（设计-实现完整度矩阵 / 引擎能力 / UI-UX / 跨端交付运维）+ 主代理对最关键结论读实际代码复核。**全程未改动任何代码。**
- **基线**：`4f7f98f`（分支 `feat/ia-viewer-metrics-reconnect`），对照 `docs/2026-06-02-mc-bot-player-design.md`（设计书）与 `docs/STATUS.md`。

> 先回答你的问题：**是的——上一份报告我只做了"缺陷向"审查（内存/bug/安全），没系统评估功能完整度，也几乎没给产品/功能建议。本份把这块补齐。**

> **⚠️ 2026-06-07 更新（对齐采纳方向，务必先读）**：原设计书 `2026-06-02` 已**过时**。经与作者确认：当时不少"额外功能"是**被采纳并继续做**的正式方向（自包含桌面引擎、AI、录制、视角、地点动作化、监听…**不是"超纲"**）；而旧 §14 DoD 的部分项是**被放弃/重定位**的——
> - **Android**：不内置引擎（手机不适合 24/7，且依赖 `canvas`/viewer 原生模块难上安卓），**重定位为"仅连远程引擎的瘦客户端"**，做不做、何时做由产品定。
> - **i18n**：**首发只做中文**，英文后期用廉价 AI 批量翻译——工程上只需"把文案外置成字典"，翻译本身不贵。
> - **扫码配对**：归入上面"手机远程客户端"范围。
> - **独立"定时页/NPC 交互页"已删**（`SchedulerTab`/`InteractionTab`）→ 定时改由**脚本触发器**承担，cron 应加在脚本触发器上。
> - 原 [ENG-2]「自动进食」**已泛化为通用「自动使用」模块**，见 [`superpowers/specs/2026-06-07-auto-use-module-design.md`](superpowers/specs/2026-06-07-auto-use-module-design.md)。
>
> 所以下文"完整度矩阵/DoD 达成度"里以**旧设计书**为基准标的"缺口/未达标"，凡涉及上述项的请按本更新**重新解读**（属放弃/重定位/后置，非缺陷）。**§2 路线图已按采纳方向重排。**

---

## 1. 执行摘要

**做了大量功能，其中很多是旧设计书外、甚至当时列为"非目标"、但现已被采纳为正式方向的**（自包含桌面引擎、AI 感知/探菜单、操作录制、应用内 3D 视角、虚拟摇杆手操、消息监听统计、地点动作化…）。引擎模块广度高（17 个），且大多做到"配置持久化 + 重连自动恢复 + 状态回传"，黑盒模块很少。这是工程亮点。

按**采纳方向**看，真正要紧的短板是：

1. **旗舰"自包含桌面引擎"没接进自动构建（上线阻断）** —— `tauri.conf.json` 把 `../engine-bundle` 列为**必需资源**，但 `beforeBuildCommand` 只构建 UI，`make-engine-bundle.mjs` **不被任何脚本/CI 调用**（已复核）→ 干净检出 `tauri build` 缺资源失败、或打出不含引擎的包。**功能在代码里，却不随 CI 出货。** [OPS-1](#ops-1)
2. **被采纳且正在改的代码里有硬伤**（详见 [`2026-06-07-code-review.md`](2026-06-07-code-review.md)）：重连僵尸连接泄漏（CORE-1，当前分支正是做重连）、Viewer 泄漏 + start/stop 竞态（Viewer 本分支新增 419 行）、OverviewTab 轮询陈旧闭包、监听正则 ReDoS 可冻整个引擎、地点动作执行的命令绕过聊天过滤。
3. **保命/通用使用缺位** —— 7×24 最大死因是饿死/被磨死，而"自动进食"应**泛化为通用「自动使用」模块**（条件→使用物品，玩家自配，auto-eat 只是默认规则），见 [`superpowers/specs/2026-06-07-auto-use-module-design.md`](superpowers/specs/2026-06-07-auto-use-module-design.md)。
4. **微软正版登录是半成品，但可行且便宜** —— 设备码流程（onMsaCode）没接（已复核），瘦客户端看不到登录码、正版登不进；mineflayer `^4.33` 原生支持，接上即可。[ENG-1](#eng-1)
5. **交付/运维只到"手工出包"**：根 `version` 仍 `0.0.0`、无 release 流水线/签名/自更新；引擎日志写到容器内临时目录（重建即丢）；无 `/metrics`；游戏密码明文落盘。

> 注：旧设计书 §14 DoD 里的 Android/i18n/扫码等，已按本报告顶部"更新"重定位（安卓 = 仅连远程、i18n = 中文先行后期 AI 翻译、定时归脚本触发器），**不再算"硬伤缺失"**。

**一句话**：功能"做了很多"，要紧的是让**采纳的旗舰能上线、能挂住、不自爆**，再按采纳方向补能力。下面是重排后的路线图。

---

## 2. 综合优先级路线图（按采纳方向重排，2026-06-07 更新）

> 按"价值/成本"排序。**缺陷类**（CORE/UI*/API）详情见 [`2026-06-07-code-review.md`](2026-06-07-code-review.md)，这里只排进优先级；**自动使用**详见 [设计文档](superpowers/specs/2026-06-07-auto-use-module-design.md)。

### P0 — 让采纳的旗舰能上线 / 能挂住 / 不自爆
| # | 事项 | 为什么是 P0 | 链接 |
|---|---|---|---|
| 1 | **引擎 bundle 接入构建/CI** | 自包含桌面是采纳旗舰，却没随 CI 出货 = 上线阻断 | [OPS-1](#ops-1) |
| 2 | **通用「自动使用」模块**（含 auto-eat 默认规则） | 保命刚需 + 通用使用机制；替代原"自动进食"（玩家自配条件→用物品） | [设计文档](superpowers/specs/2026-06-07-auto-use-module-design.md) |
| 3 | **修采纳且在改代码里的硬伤** | 重连僵尸泄漏 CORE-1 / Viewer 泄漏+竞态 / Overview 陈旧闭包 / 监听 ReDoS / 聊天安全旁路 | [code-review](2026-06-07-code-review.md) |
| 4 | **破坏性操作统一二次确认/撤销** | 删脚本/地点/JS/规则/丢物品一点即删、不可恢复 | [UX-1](#ux-1) |

### P1 — 已确认要、且可行划算
| # | 事项 | 价值/成本 | 链接 |
|---|---|---|---|
| 5 | **bots/scripts 导入导出 + 备份恢复**（换机/灾备/分享；养多号尤其需要，且能在大改前先保住现有配置）⬆️**提前** | 高 / 小 | [ENG-4](#eng-4)/[OPS-6](#ops-6) |
| 6 | **多 bot 协同/批量操作 + 分组 + 侧栏搜索**（批量开关/发指令/重连——多开刚需）⬆️**提前** | 高 / 中 | [ENG-5](#eng-5)/[UX-10](#ux-10) |
| 7 | **正版登录设备码流程**（onMsaCode → 前端弹登录码 + 缓存 token） | 高 / 小（mineflayer `^4.33` 原生支持） | [ENG-1](#eng-1) |
| 8 | **手机端 = 仅连远程瘦客户端**：`tauri android` 真包 + 扫码连接（**放弃**手机内置引擎） | 中 / 中 | [COMP-1](#comp-1)/[COMP-3](#comp-3)/[OPS-9](#ops-9) |
| 9 | **脚本触发器加 cron**（替代已删的独立定时页） | 中 / 小 | [ENG-3](#eng-3) |
| 10 | **release 流水线 + 单一版本源 + 签名/自动更新** | 高 / 中 | [OPS-2](#ops-2)/[OPS-3](#ops-3) |
| 11 | **修日志落点 + 最小可观测面 `/metrics`** | 中 / 小 | [OPS-4](#ops-4) |

### P2 — 体验与能力增强（可排期）
| # | 事项 | 链接 |
|---|---|---|
| 12 | i18n：先把文案**外置成 `zh` 字典**（英文后期廉价 AI 批量翻；翻译不贵，贵在抽取） | [COMP-2](#comp-2)/[UX-7](#ux-7) |
| 13 | Modal 无障碍（Esc/焦点陷阱/aria）+ 图标按钮 aria-label | [UX-2](#ux-2)/[UX-3](#ux-3) |
| 14 | AI Tab 做成真闭环（贴回 JSON 一键存/跑） | [UX-4](#ux-4) |
| 15 | 通用"满了就近存箱"原语（农场/挖矿/清理共用） | [ENG-9](#eng-9) |
| 16 | 挖矿矿脉跟踪 + 农场作物扩展 | [ENG-6](#eng-6) |
| 17 | AI observe 加方块/地形感知 + AI 单步动作通道 | [ENG-7](#eng-7) |
| 18 | 长列表/日志虚拟化 + 截断项可展开 | [UX-5](#ux-5) |
| 19 | 模块配置项渲染 hint 说明 + 输入校验（自动使用配置会顺带做） | [UX-6](#ux-6) |
| 20 | 断线重连用户可见反馈（"已恢复连接"） | [UX-8](#ux-8) |
| 21 | 配置治理：删死代码 validateEnv + `.env.example` + 启动校验 | [OPS-5](#ops-5) |
| 22 | Docker 非 root + 资源限制 + 发布镜像；CI 纳入 typecheck | [OPS-8](#ops-8)/[OPS-7](#ops-7) |
| 23 | 战斗装备切换+目标过滤；测试基线（模块单测+zod） | [ENG-8](#eng-8)/[COMP-5](#comp-5) |
| 24 | 敏感数据加密 + 令牌轮换入口；onboarding 引导 | [OPS-10](#ops-10)/[UX-9](#ux-9) |

---

## 3. 功能完整度矩阵（设计 §7.4 迁移清单 + 实际能力）

状态：✅完成 / 🟡基本可用有短板 / 🟧最小可用·仅桩 / ❌缺失 / 🔵设计内本版未做

| 功能/模块 | 状态 | 已支持 | 缺口/未支持 | 证据 |
|---|---|---|---|---|
| 战斗 combat | 🟡 | 范围/最大目标/玩家·怪开关/防击退/距离优化 | 无武器切换、无低血逃跑、无视线判断、animal 易误杀 | `combat.js:5-13,31,66-76` |
| 追怪 mob_hunter | ✅(小缺) | 关键词/全怪、区域(圆+盒)、归家、死亡处理、强反作弊、与杀戮光环互斥、物品黑名单 | **无玩家白名单**、无低血撤退/吃药、无弓/弹射物 | `mob_hunter.js:22-62,287-362` |
| 钓鱼 fishing | 🟡 | 自动抛收/超时重试/无竿关闭/备用竿 | 耐久阈值硬编码 64(误判附魔竿)、无自动续竿、无附魔偏好 | `fishing.js:42-53` |
| 定制钓鱼 fishing_hotspot | 🟧 | **仅"粒子嗅探诊断"打日志** | 未实现"对准热点→抛竿→咬钩"正式逻辑；粒子表仅 1.12 | `fishing_hotspot.js:1-26` |
| 挖矿 automine | ✅(小缺) | 状态机/多目标/最佳工具/拟人/背包满策略/统计 | 无矿脉跟踪、无分支隧道、restock/hazardAvoid 是占位未实现 | `automine.js:6-11,135-256` |
| 农场 auto_farm | 🟡 | 6 作物/合并扫描/补种/骨粉/统计 | **作物硬编码 6 种**(无甘蔗/可可/竹/地狱疣)、补种依赖站位、无存箱 | `auto_farm.js:7-14,109-140` |
| 垃圾清理 trash_cleaner | 🟡 | 黑名单整叠丢弃/轮询/持久化 | 只能丢不能存箱、子串匹配易误伤、无白名单/保留数 | `trash_cleaner.js:26-54` |
| 消息监听 message_monitor | ✅ | 可配正则/中文单位/多种聚合/分桶/持久化/跨重连保留 | 无告警阈值/通知、无历史曲线 | `message_monitor.js:9-21,122-150` |
| 计分板/BossBar scoreboard | ✅ | 侧栏(队伍前后缀)/BossBar/兜底刷新/按词取值 | 不读 belowName/list | `scoreboard.js:8-14,37-74` |
| 背包 player_inventory | ✅ | 全槽同步(NBT/Lore/附魔/贴图)/丢装持用/智能"使用"/流水/防抖 | 无跨容器转移、无指定槽、无合成 | `player_inventory.js:43-77` |
| GUI 交互 window_gui | ✅ | 窗口序列化/点击关闭/扫描容器/坐标开箱/**AI 探菜单下钻** | 无拖拽/shift/数字键换位、无创造取物 | `window_gui.js:86-206` |
| NPC 交互 interact | ✅ | 扫描 32 格(Citizens 名修正)/右键交互/寻路靠近 | 无对话树自动应答、无批量 | `interact.js:25-110` |
| 定时 scheduler | 🟡 | settings.schedules 的 HH:MM→发指令/防重复 | **仅 HH:MM**(无 cron/星期/间隔)、只能发指令 | `scheduler.js:4-34` |
| 录制 recorder | ✅ | 录命令→步骤/自动补 wait/按显示名录 slot(跨服稳) | 不录移动/视角、仅命令级 | `recorder.js:50-120` |
| 脚本 script_engine | ✅ | 双模式/30+动作/if·repeat·while/子脚本+参数/变量+数学/6类触发/GUI智能等待/重试/断线续跑/死循环保护 | schedule 触发仅 HH:MM、无并行、无 try/catch、单运行槽 | `script_engine.js:316-945` |
| 自定义 JS custom_js | 🟡 | AsyncFunction 运行时/文档化 API/停止取消 | **默认禁用**(=持令牌 RCE 才开)、无沙箱/超时/并发 | `custom_js.js:76-107` |
| 视角 bot_viewer | ✅ | prismarine-viewer/一三人称/端口池/点击寻路 | 切人称需重启、无录像/截图 | `bot_viewer.js:43-88` |
| 地点(MODULE_ACTION) | ✅ | 保存(坐标+前置命令+到达脚本)/删/前往/**指令·GUI录制·多世界三档** | 上限 5、无分组/导入导出、跨 bot 不共享 | `BotInstance.js:531-633` |
| 行为(MODULE_ACTION) | 🟡 | 破坏模式开关/复活命令/自动 /login | **无自动进食**、无防 AFK、无低血处理、登录仅单条命令 | `moduleHandlers.ts:328-347` |
| 手操(MODULE_ACTION) | ✅ | goto/stop/摇杆/转视角/无破坏寻路 | 无坐标序列巡逻、无持久跟随(脚本里有) | `moduleHandlers.ts:278-325` |
| AI observe 感知 | ✅ | self/背包/附近实体玩家/威胁/计分板/serverText/环境/摘要 | **无方块·地形感知**、无寻路可达性 | `observe.ts:156-380` |
| AI 反向驱动 | 🟡 | observe+探菜单+提交脚本(存即跑)/函数文档 | AI 不能发单步动作、无 AI 直连、无流式反馈 | `AI_INTEGRATION.md:123-172` |
| 微软正版登录 | ❌ | 类型/字段透传 mineflayer | **设备码流程(onMsaCode)未接**，UI 拿不到登录码→实际登不进 | `BotInstance.js:89-98`(grep onMsaCode 无) |
| 多 bot 协同/批量 | ❌ | 单 bot 逐个；脚本库全局共享 | 无批量开关/发令、无分组、无协同 | `handlers.ts`(命令均单 id) |
| 备份/导入导出 | 🟧 | storage 原子写+.bak+损坏留档 | 无 UI/API 导出导入、无迁移、无定期快照 | `storage.ts:40-52` |
| 模板/预设 | ❌ | 脚本可手动复用 | 无配置模板、无一键预设、无分享 | 全仓无 template/preset |
| Android 客户端 | ❌ | 仅占位 + UI 响应式 | **无 src-tauri 工程**(已复核)、无签名/多架构/启动屏/权限 | `apps/mobile/`(仅 2 文件) |
| i18n 中/英 | ❌ | — | 无 i18n 库、全硬编码中文 | 全 `packages/ui` 无 i18next |
| 二维码扫描配对 | 🟧 | 引擎**生成** QR | 客户端无相机/扫码(依赖缺失的移动端) | `SettingsDialog.tsx:63` 生成; 无扫描 |

---

## 4. DoD（§14 验收定义）达成度

- **§14.1 Docker 引擎 24/7 + 持久化 + 令牌保护 + 多机器人**：🟡 — 令牌/持久化/多 bot/compose 策略均✅；但本机未实测构建运行（需 WSL2），"跑通"待确认。[COMP-8](#comp-8)
- **§14.2 Win+Android 可安装 + 扫码/连接串配对 + 全模块遥控 + Claude 风格 + 深浅色 + 中/英文**：❌ — Windows/连接串/全模块/风格/深浅色✅；但 **Android 缺失**[COMP-1](#comp-1)、**扫码缺失**[COMP-3](#comp-3)、**英文/i18n 缺失**[COMP-2](#comp-2)，多子项不达标。
- **§14.3 性能达标 + 测试与 CI 通过 + 文档齐全**：🟡 — 文档齐全✅、CI 存在且引擎测试通过✅；但 P7 无实测阈值数字（仅文档化措施）、测试基线薄[COMP-5](#comp-5)、CI 缺 Android[COMP-6](#comp-6)。

---

## 5. 重点完整度缺口（COMP）

<a id="comp-1"></a>**[COMP-1] 高 · Android 客户端事实缺失** — `apps/mobile/` 仅 `package.json`(描述仍"Phase 5 搭建")+`README`，**无 `src-tauri`/任何工程文件**（已复核 `find` 仅返回目录本身）。STATUS 称用 desktop 工程出过 arm64 debug APK，但仓库内无可复现的 Android target/签名/工程。DoD §14.2 必须项。**建议**：要么在 `apps/mobile` 落地真实 Tauri Android 工程并写进 BUILD.md+CI，要么正式把"安卓"重定义为"desktop 工程加 android target 的瘦客户端"，删除误导性占位包（见 [OPS-9](#ops-9)）。

<a id="comp-2"></a>**[COMP-2] 高 · i18n 完全未实现** — 无任何 i18n 库、无 locale 字典、设置页无语言切换，全文案硬编码中文。DoD §14.2 与 Phase 6 都要求中/英文。**建议**：引入 react-i18next/lingui，抽 `zh` 资源补 `en`；或文档正式降级为"首发仅中文"。（见 [UX-7](#ux-7)）

<a id="comp-3"></a>**[COMP-3] 中 · 二维码"扫描"配对缺失（生成≠扫描）** — 引擎能生成 QR，但客户端无相机/扫码组件，连接屏"手机端可扫描"是空头承诺；根因是移动端缺失。**建议**：移动端补 `tauri-plugin-barcode-scanner` + 自动解析 `mcbot://` 串。

<a id="comp-4"></a>**[COMP-4] 中 · 范围蔓延：内置 Windows 引擎（§1.3 非目标）已被实现** — 设计 §1.3 明确"第一版不做 Windows 内置引擎"、列为 Phase B 后续，但 `apps/desktop/src-tauri/src/lib.rs` 已完整做了 sidecar 引擎。这是把后续阶段提前做了（增强），但精力投到了非目标，而 DoD 必须项反而缺。**建议**：非缺陷，但应更新设计书/STATUS 标记"Phase B 已提前完成"，并据此重排优先级补齐 DoD（并接入构建，见 [OPS-1](#ops-1)）。

<a id="comp-5"></a>**[COMP-5] 中 · 测试基线远低于 §10 计划** — §10 规划了模块 mock-bot 单测 + 协议 zod 运行时校验 + UI 组件测试；实际只有 `control-plane.cjs` 一个端到端脚本，无模块单测、无 zod、无 UI 测试。**建议**：给 script_engine/auto_farm/mob_hunter 等加 mock-bot 单测；协议关键命令负载加 zod schema。

<a id="comp-6"></a>**[COMP-6] 中 · CI 缺 Android 构建**（且镜像仅 build 不 push） — `ci.yml` 有 engine-image + desktop-windows，无 Android job；engine-image `push:false`。**建议**：补 Android job（依赖 COMP-1）；如要发布镜像再加 push。（见 [OPS-7](#ops-7)/[OPS-8](#ops-8)）

<a id="comp-7"></a>**[COMP-7] 低 · 追怪缺玩家白名单** — `mob_hunter` 只有击杀目标的物品黑名单 + "检测到任意玩家就暂停"，无"允许某些玩家在场仍继续"的白名单。**建议**：补玩家白名单字段，安全暂停时跳过白名单玩家。

<a id="comp-8"></a>**[COMP-8] 低 · Docker 引擎未在本机验证跑通** — Dockerfile/compose 完备，但 STATUS 承认因缺 WSL2 未实际 `up`。**建议**：在 WSL2/Linux 跑一次冒烟（起容器→/health→加机器人→重启验持久化）回填 STATUS。

<a id="comp-9"></a>**[COMP-9] 低 · 协议三个 location 顶层命令冗余未接线** — `ClientCommands.LOCATION_SAVE/DELETE/GOTO` 有定义但 `handlers.ts` 无处理器，实际地点功能全走 `MODULE_ACTION` 的 `location:*`。属"已被等价实现"的契约冗余。**建议**：清理这三个未用命令或补成正式处理器以消除歧义。

---

## 6. 引擎能力短板与增强建议（ENG）

<a id="eng-1"></a>**[ENG-1] 接通微软正版登录设备码流程** · 价值高 · 成本小 — `auth:"microsoft"` 能传给 mineflayer，但设备码（user_code + verification_uri）只会打到引擎 stdout，瘦客户端用户根本看不到，**正版账号实际无法登录**。**落点**：`BotInstance.js:89-98` createBot 加 `onMsaCode` 回调 → `io.emit` 推新事件（如 `bot:msa_code`）给前端弹"打开 microsoft.com/link 输入 XXXX"；`botManager.ts` 透传；protocol 加事件类型；token 缓存走 `MCBOT_DATA_DIR` 下 profilesFolder。

<a id="eng-2"></a>**[ENG-2] 通用「自动使用」模块（含 auto-eat 默认规则）** · 价值高 · 成本中 — 起点是"自动进食"，但本质是**「条件 → 使用物品」**：进食、喝奶解 debuff、金苹果回血、续 buff、定时用钥匙…都是同一机制。**模块不内置物品语义、玩家自配规则**，auto-eat 只是出厂默认规则。**协调**用一个 `bodyBusy` 标志（零优先级）：用东西时其它循环让一拍、用完切回原手持。**落点**：新增 `modules/auto_use.js`、复用 `player_inventory.js` 的 `useSlot` 智能分流、`BotInstance.js` 加 `bodyBusy` + restoreModules 恢复 + 在 combat/mob_hunter/automine/auto_farm tick 顶部加让位。**完整设计见 [`superpowers/specs/2026-06-07-auto-use-module-design.md`](superpowers/specs/2026-06-07-auto-use-module-design.md)。**

<a id="eng-3"></a>**[ENG-3] 定时升级为 cron（落在脚本触发器）** · 价值中 · 成本小 — 脚本 `schedule` 触发器只支持 HH:MM，无法表达"每周一/每 6 小时/仅工作日"——每日每周领奖是刚需。独立"定时页"(`SchedulerTab`)已删，定时统一归**脚本触发器**。**落点**：`script_engine.js shouldTrigger` 引入 cron 解析；`ScriptTrigger`/`Schedule` 类型扩 cron 字段；让定时项除发指令外也能触发脚本/模块。

<a id="eng-4"></a>**[ENG-4] bots.json/scripts.json 导入导出 + UI 备份恢复** · 价值高 · 成本小 — 目前只有 storage 内部 .bak，用户无法主动导出/迁移/分享。**落点**：server 加 `GET/POST /api/export`、`/api/import`（鉴权）；前端加按钮。（与 [OPS-6](#ops-6) 同）

<a id="eng-5"></a>**[ENG-5] 多 bot 批量操作与分组** · 价值中 · 成本中 — 所有命令单 `id`，养多号只能逐个点，无分组。**落点**：加 `BOT_BATCH`（对 id 数组广播 toggle/chat/script），botManager 加分组字段（`eachInstance` 已有基础），前端多选。

<a id="eng-6"></a>**[ENG-6] 挖矿矿脉跟踪 + 农场作物扩展** · 价值中 · 成本中 — automine 挖完一块即回扫不顺脉；农场硬编码 6 种缺高频经济作物。**落点**：doMine 后对相邻同类方块 flood-fill 队列；CROP_DATABASE 扩种类 + 茎类/丛生作物采集逻辑。

<a id="eng-7"></a>**[ENG-7] AI observe 加方块/地形感知 + AI 单步动作通道** · 价值中 · 成本中 — observe 无任何方块信息（脚下/面前/附近矿石·容器坐标），AI 写"挖矿/搭路/找箱"是盲写；且 AI 只能提交整本脚本不能发单步做闭环。**落点**：observe 加 `surroundings`（findBlocks 摘要）+ 加 `POST /api/act/:id` 执行单 step（复用 runSteps）。

<a id="eng-8"></a>**[ENG-8] 战斗装备切换 + 目标过滤精细化** · 价值中 · 成本小 — 杀戮光环不切武器、attackMobs 把 animal 当敌对会误杀牧场动物、无逃跑。**落点**：combat.js 攻击前 equip 最佳武器（复用脚本 equip_best_weapon）、敌对/动物/玩家三档独立开关、低血暂停（联动 [ENG-2](#eng-2)）。

<a id="eng-9"></a>**[ENG-9] 统一"满了就近存箱"原语** · 价值中 · 成本中 — trash_cleaner/农场/挖矿都只会"丢弃"或停机，缺通用存箱。**落点**：抽 `depositToChest(chest, keepList)` 到 window_gui/inventory，trash_cleaner 加"存箱模式"、automine.restock（已有占位）落地。

<a id="eng-10"></a>**[ENG-10] 运维可观测性：指标端点 + 关键告警** · 价值中 · 成本小 — 只有 /health，看不到"几个在线/谁在重连/谁 fatal/各模块运行数"。**落点**：加 `GET /metrics`（数据 buildSnapshot 已有）；compose 文档化 `ENGINE_ALLOW_JS`/`ENGINE_HOST`/`ENGINE_VIEWER_DISTANCE`。（与 [OPS-4](#ops-4) 同向）

<a id="eng-11"></a>**[ENG-11] 正式钓鱼热点对准（承接 fishing_hotspot 阶段一）** · 价值低-中 · 成本中 — fishing_hotspot 明说只到诊断阶段。**落点**：基于已抓到的粒子 id，实现"找最近热点→lookAt 对准→抛竿→咬钩→收杆"循环，并入 fishing.js 作为"热点模式"。

<a id="eng-12"></a>**[ENG-12] custom_js 沙箱化或细粒度授权** · 价值低 · 成本大 — 现在要么全关、要么 =RCE，无中间档。**落点**：用 `isolated-vm` 替代裸 AsyncFunction + 超时 + API 白名单，使其可在不暴露主机前提下默认开放。面向多用户托管才必要。

---

## 7. UI/UX 完整度与改进建议（UX）

> 逐屏完整度（节选）：连接屏/Viewer/Inventory/Modules/Scripts/Settings/AddBot ✅完整；BotPanel/LiveTab/ScriptEditor/Locations/Console/CustomJs 🟡有短板；ModuleConfigDialog/AiTab/通用 Modal 🟧最小可用。系统性缺口：**a11y 几乎为零、删除确认不一致、大数据无虚拟化、AI 半自动、无 i18n、无 onboarding/快捷键/批量**。

<a id="ux-1"></a>**[UX-1] 破坏性操作统一二次确认/撤销** · 价值高 · 成本小 — 删 bot 有确认，但删脚本(`ScriptsTab.tsx:100`)、删地点(`LocationsTab.tsx:186`)、删 JS(`CustomJsPanel.tsx:61`)、删监听规则(`MonitorPanel.tsx:98`)、丢整组物品(`InventoryTab.tsx:404`)、清空日志(`Console.tsx:90`)**全部一点即删、不可撤销**。**建议**：复用 `Modal` 做统一 `confirm()`，或给删除型 toast 加 4s"撤销"（toast 已有 4s 生命周期，改造成本低）。

<a id="ux-2"></a>**[UX-2] Modal 无障碍 + Esc 关闭** · 价值高 · 成本中 — `Modal.tsx:28-54` 无 `role=dialog`/`aria-modal`、不锁 Tab 焦点、不监听 Esc、打开不自动聚焦；ScriptEditor 自定义弹层同样缺。**建议**：Modal 内加 Esc 关闭、首元素 autofocus、focus trap、`role/aria-*`。一处改动惠及全部弹窗。（与缺陷报告 UICORE-4 呼应）

<a id="ux-3"></a>**[UX-3] 图标按钮补 aria-label，Tab 栏键盘可达** · 价值高 · 成本小 — 大量纯图标 `<button>` 仅 `title` 无 `aria-label`；`BotPanel.tsx:190-199` Tab 栏是裸 button，无 `role=tablist`/方向键。**建议**：图标按钮统一 `aria-label`；Tab 栏加 ARIA tabs + ←/→ 切换。

<a id="ux-4"></a>**[UX-4] AI Tab 做成真正闭环** · 价值高 · 成本中 — 现在只能"复制提示词"，要手动贴到外部 AI 再把 JSON 粘回脚本页——三步断裂，且页内已引用 `POST /api/ai/script/:id` 却没接。**建议**：加"贴入 AI 返回 JSON → 一键校验存为脚本/直接运行"（复用 ScriptEditor 的 JSON 解析与 `cmd.script.save`）。这是当前最大的"看着全、实则半截"的体验落差。

<a id="ux-5"></a>**[UX-5] 长列表/日志虚拟化 + 截断项可展开** · 价值中 · 成本中 — Console 500 行全量渲染 DOM（刷屏服卡）；Overview 附近每组 `slice(0,6)` 只给"+N 更多"不可展开；LiveTab NPC/容器 `slice(0,14/12)` 直接丢；满背包全量渲染。**建议**：日志/背包接轻量虚拟列表；"+N 更多"可点击展开；扫描结果给"显示全部"。

<a id="ux-6"></a>**[UX-6] 模块配置项加说明与校验** · 价值中 · 成本小 — `FieldDef.hint` 已定义(`moduleDefs.ts:17`)却**从不渲染**(`ModuleConfigDialog.tsx:69-84`)；number 输入允许空/超 min-max 直接保存。**建议**：渲染 `hint` 为字段下方灰字；保存前 clamp 到 min/max 并对必填空值红字提示。

<a id="ux-7"></a>**[UX-7] 引入 i18n 框架** · 价值中 · 成本大 — 全硬编码中文，跨端面向"玩家"却锁死单语言。**建议**：接 react-i18next，先抽 `zh` 资源、留 `en` 骨架。属产品级硬伤，建议排期。（同 [COMP-2](#comp-2)）

<a id="ux-8"></a>**[UX-8] 断线重连用户可见反馈补全** · 价值中 · 成本小 — socket 无限重连，但**重连成功后无"已恢复连接"提示**，失败/令牌失效也只在 connecting↔error 间跳，用户不知进展。**建议**：重连成功 toast"已恢复连接"；超阈值给"仍在重连…可检查引擎"。

<a id="ux-9"></a>**[UX-9] 首次使用 onboarding / 空状态引导** · 价值中 · 成本中 — 有空状态文案但全程无引导，强功能（监听正则、录制、JS）藏得深。**建议**：首连后给 3-4 步引导（添加 bot→开模块→看视角）；或各 Tab 空态加"它能做什么 + 示例按钮"。

<a id="ux-10"></a>**[UX-10] 全局快捷键 + 多 bot 批量 + 侧栏搜索** · 价值低-中 · 成本中 — 仅聊天 ↑/↓ 和操控 WASD，无全局快捷键；Sidebar 无搜索、无多选批量。**建议**：`Ctrl+K` 切 bot、数字键切 Tab、`/` 聚焦聊天；Sidebar 多选 + 批量重连/停止（多开刚需，联动 [ENG-5](#eng-5)）。

---

## 8. 跨端 / 交付 / 运维完整度与建议（OPS）

> 总体：功能层完整，但**交付与运维只到"作者机器手工出包"**，离"可重复发布 + 7×24 可运维"有明显差距。

<a id="ops-1"></a>**[OPS-1] 把自包含引擎 bundle 接入构建与 CI（桌面发布的硬阻断）** · 价值高 · 成本中 — **已复核**：`make-engine-bundle.mjs` 无任何 package.json 脚本/`beforeBuildCommand`/CI 调用；而 `tauri.conf.json:33-34` 把 `../engine-bundle` 列为**必需打包资源**，`beforeBuildCommand` 只 `pnpm --filter @mcbot/ui build`，CI 仅 `pnpm -C apps/desktop tauri build`。结果：干净检出下安装包要么因缺资源失败、要么不含内置引擎，"双击即用"落空。**落点**：`apps/desktop/package.json` 加 `bundle:engine` 脚本、`tauri.conf.json` `beforeBuildCommand` 串入 bundle 生成、`ci.yml` build 前先跑 bundle。

<a id="ops-2"></a>**[OPS-2] 建立 release 流水线 + 单一版本源** · 价值高 · 成本中 — CI 只构建不发布；根 `version` 还是 `0.0.0`，桌面/Cargo/tauri.conf 三处版本手工各改易漂移；用户无处下载、无版本可追溯。**落点**：新增 tag 触发的 `release.yml`（GH Release 挂 msi/nsis/APK + 推镜像到 ghcr），用一个版本源同步三处。

<a id="ops-3"></a>**[OPS-3] 桌面自动更新 + 代码签名** · 价值高 · 成本中 — 7×24 客户端无自更新，修 bug 要手动重装；Windows 无签名→SmartScreen 拦截。**落点**：接 `tauri-plugin-updater`（pubkey/endpoints + 产 latest.json），预留签名路径。

<a id="ops-4"></a>**[OPS-4] 修复日志落点 + 最小可观测面** · 价值高 · 成本小 — `logger.js:15` 把日志写到 `__dirname/../logs`（编译后=容器/bundle 内 `dist/logs`），**不在 `/data` 卷**→重建即丢，且与 `MCBOT_DATA_DIR` 脱节；/health 外无指标。**落点**：日志目录改走 `dataDir()`；补 `/metrics`（或扩展 /health：botCount/online/rss/重连数）。

<a id="ops-5"></a>**[OPS-5] 配置治理：删死代码 validateEnv + 补 `.env.example` + 真正启动校验** · 价值中 · 成本小 — `validateEnv.js` 从未被调用且校验的是本项目不用的 `SESSION_SECRET`/HTTPS；`.gitignore` 白名单了 `.env.example` 却无该文件；env 项无集中文档。**落点**：删/重写为校验真实变量并在 serve 启动调用；补 `.env.example`。（与缺陷报告 API-4 呼应）

<a id="ops-6"></a>**[OPS-6] 导入导出 + 备份恢复 + schema 版本** · 价值中 · 成本中 — 换机/升级/灾备无迁移路径；JSON 无版本字段难平滑迁移。**落点**：API/UI 导出导入（bots+scripts+custom_scripts），JSON 顶层加 `schemaVersion`。（与 [ENG-4](#eng-4) 同）

<a id="ops-7"></a>**[OPS-7] CI 纳入 typecheck/lint + 安卓构建 job** · 价值中 · 成本小 — 有 `pnpm typecheck` 脚本却没进 CI；安卓声称复用工程但 CI 完全不验。**落点**：build-test 加 `pnpm typecheck`；加 `android-build` job（Linux runner 装 NDK 出 debug APK，规避 Windows 软链接）。

<a id="ops-8"></a>**[OPS-8] Docker 非 root + 资源约束 + 发布镜像** · 价值中 · 成本小 — 容器全程 root（无 `USER`）；4G 主机指引却无 compose 资源限制；镜像 CI 不 push。**落点**：Dockerfile 加非 root user、compose 加 `mem_limit`/`deploy.resources`、CI 推镜像并在 README 给 `docker run ghcr.io/...` 路径。

<a id="ops-9"></a>**[OPS-9] 安卓收尾 + 明确"仅连远程"定位** · 价值中 · 成本中 — 内置引擎是 `#[cfg(desktop)]`+`node.exe`，**安卓跑不了内置引擎**（只能连远程），但文档未点明；距上架还差 release 签名、多架构、启动屏、权限声明、AAB。**落点**：文档明确"安卓=瘦客户端只连远程引擎"，补签名/多架构/启动屏/权限与 release 脚本。（依赖 [COMP-1](#comp-1)）

<a id="ops-10"></a>**[OPS-10] 敏感数据加密 + 令牌轮换** · 价值中 · 成本中 — 服务器 `/login` 密码以 `loginPassword` 明文存 `bots.json`（随卷/AppData 落盘）；访问令牌无轮换/找回（改 token 后所有客户端需手动重配）。**落点**：对 loginPassword 做静态加密或走 OS keystore；给令牌"重置并显示新连接串/二维码"的运维入口。（与缺陷报告 API-10 呼应）

---

## 9. 附录：方法与已验证项

**方式**：4 个并行只读子代理分头审查（设计-实现完整度 / 引擎能力 / UI-UX / 跨端交付运维），各自读取实际代码与文档并给 file:line 证据；主代理对最关键结论读代码复核。**未改动任何代码。**

**已 ✅ 读代码复核**：
- [OPS-1] 引擎 bundle 未接入构建：`apps/desktop/package.json` 无相关脚本、`tauri.conf.json` `beforeBuildCommand` 仅构建 UI 且 `resources` 必需 `../engine-bundle`、`ci.yml` 仅 `tauri build`、`make-engine-bundle.mjs` 无任何引用 —— 全部确认。
- [ENG-1] MS 设备码流程缺失：engine 内 `onMsaCode`/`deviceCode` grep 无命中（"msa" 命中为 `itemsArray` 误匹配）—— 确认。
- [COMP-1] Android 工程缺失：`apps/mobile` 下无 `src-tauri` 等任何子目录 —— 确认。

**与缺陷报告的关系**：本份只谈"功能完整度 + 改进建议"；内存泄漏/bug/竞态/安全见 [`2026-06-07-code-review.md`](2026-06-07-code-review.md)，架构/贴图/早期风险见 [`2026-06-05-code-architecture-review.md`](2026-06-05-code-architecture-review.md)。三份互补，不重复。

**局限/待确认**：i18n/Android/扫码缺失基于静态证据；Docker"24/7 跑通"与 CI 安装包"是否真不含引擎"建议各跑一次实测确认（前者需 WSL2，后者跑一次 CI 看 `tauri build` 对缺失 `engine-bundle` 目录的实际行为）；AI Tab 是否能走通后端代生成、McText 彩色文本对比度，标"待确认"。
