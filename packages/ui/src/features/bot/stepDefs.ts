// 可视化脚本步骤的字段 schema（覆盖常用的扁平步骤；if/repeat 等嵌套步骤在 JSON 模式编辑）

export interface StepFieldDef {
  k: string;
  label: string;
  type: "text" | "number" | "bool" | "select";
  /** select 的选项 */
  options?: { value: string | number; label: string }[];
}

const BTN_OPTS = [
  { value: 0, label: "左键" },
  { value: 1, label: "右键" },
];
export interface StepContainerDef {
  key: string; // 嵌套 steps 数组所在的字段名（如 steps / then / else）
  label: string;
}
export interface StepTypeDef {
  do: string;
  label: string;
  fields: StepFieldDef[];
  /** 含子步骤的控制块（if/repeat/while） */
  containers?: StepContainerDef[];
  /** 收进「高级（不常用）」分组：手填坐标、单脉冲跳跃等不切实际/易错的步骤。
   *  引擎 case 仍保留，老脚本照常运行；只是不在常用调色板里推荐。 */
  advanced?: boolean;
}

export const STEP_TYPES: StepTypeDef[] = [
  { do: "chat", label: "发送消息", fields: [{ k: "msg", label: "消息", type: "text" }] },
  { do: "cmd", label: "执行命令", fields: [{ k: "cmd", label: "命令(含 /)", type: "text" }] },
  {
    do: "whisper",
    label: "私聊玩家",
    fields: [
      { k: "player", label: "玩家", type: "text" },
      { k: "msg", label: "消息", type: "text" },
    ],
  },
  { do: "wait", label: "等待(秒)", fields: [{ k: "s", label: "秒", type: "number" }] },
  { do: "log", label: "输出日志", fields: [{ k: "msg", label: "内容", type: "text" }] },
  { do: "note", label: "注释(不执行)", fields: [{ k: "text", label: "备注内容", type: "text" }] },
  {
    do: "goto",
    label: "走到坐标",
    fields: [
      { k: "x", label: "X", type: "number" },
      { k: "y", label: "Y", type: "number" },
      { k: "z", label: "Z", type: "number" },
    ],
  },
  { do: "return_home", label: "回家(名为「家」的地点)", fields: [] },
  { do: "equip", label: "装备物品", fields: [{ k: "item", label: "物品名", type: "text" }] },
  { do: "equip_best_weapon", label: "装备最强武器", fields: [] },
  {
    do: "equip_best_tool",
    label: "装备最佳工具",
    fields: [{ k: "block", label: "目标方块名(空=准星方块)", type: "text" }],
  },
  {
    do: "drop",
    label: "丢弃物品",
    fields: [
      { k: "item", label: "物品名", type: "text" },
      { k: "count", label: "数量", type: "number" },
    ],
  },
  {
    do: "drop_all",
    label: "清空背包(保留…)",
    fields: [{ k: "keep", label: "保留关键词(逗号分隔,空=全丢)", type: "text" }],
  },
  {
    do: "deposit",
    label: "存入箱子(可先去仓库地点)",
    fields: [
      { k: "item", label: "物品名关键词(空=除装备全部)", type: "text" },
      { k: "location", label: "仓库地点名(可空=就近找箱)", type: "text" },
    ],
  },
  { do: "use_item", label: "使用手持物品", fields: [] },
  {
    do: "dig",
    label: "挖最近的方块",
    fields: [
      { k: "block", label: "方块名(如 oak_log)", type: "text" },
      { k: "distance", label: "搜索距离(默16)", type: "number" },
    ],
  },
  {
    do: "craft",
    label: "合成物品(自动找工作台)",
    fields: [
      { k: "item", label: "物品名(如 stick)", type: "text" },
      { k: "count", label: "数量(默1)", type: "number" },
    ],
  },
  { do: "attack", label: "攻击实体", fields: [{ k: "entity", label: "实体名", type: "text" }] },
  {
    do: "interact",
    label: "右键实体/NPC",
    fields: [{ k: "target", label: "实体名/NPC名", type: "text" }],
  },
  {
    do: "look_at",
    label: "看向最近的人/生物",
    fields: [{ k: "target", label: "目标(空=玩家/mob/名字)", type: "text" }],
  },
  {
    do: "goto_nearest",
    label: "走向最近的人/生物",
    fields: [
      { k: "target", label: "目标(空=玩家/mob/名字)", type: "text" },
      { k: "distance", label: "停下距离(默2)", type: "number" },
    ],
  },
  {
    do: "hold",
    label: "按住键N秒(潜行/前进…)",
    fields: [
      {
        k: "key",
        label: "控制键",
        type: "select",
        options: [
          { value: "forward", label: "前进" },
          { value: "back", label: "后退" },
          { value: "left", label: "左移" },
          { value: "right", label: "右移" },
          { value: "jump", label: "跳跃" },
          { value: "sneak", label: "潜行" },
          { value: "sprint", label: "疾跑" },
        ],
      },
      { k: "s", label: "秒数", type: "number" },
    ],
  },
  {
    do: "sneak",
    label: "潜行开/关",
    fields: [{ k: "active", label: "开启(取消勾选=停止)", type: "bool" }],
  },
  // ↓↓↓ 高级（不常用）：手填坐标、单脉冲跳跃、切副手——易错或很少需要，收进折叠分组。
  { do: "jump", label: "跳一下", fields: [], advanced: true },
  { do: "swap_hands", label: "切换副手", fields: [], advanced: true },
  {
    do: "look",
    label: "看向坐标",
    fields: [
      { k: "x", label: "X", type: "number" },
      { k: "y", label: "Y", type: "number" },
      { k: "z", label: "Z", type: "number" },
    ],
    advanced: true,
  },
  {
    do: "place",
    label: "放置方块(按坐标,易错)",
    fields: [
      { k: "item", label: "物品名", type: "text" },
      { k: "x", label: "X", type: "number" },
      { k: "y", label: "Y", type: "number" },
      { k: "z", label: "Z", type: "number" },
    ],
    advanced: true,
  },
  {
    do: "wait_spawn",
    label: "等待重生",
    fields: [{ k: "timeout", label: "超时(秒,默30)", type: "number" }],
    advanced: true,
  },
  // ===== GUI / 界面交互（服务器定制菜单：开菜单 → 等界面 → 找物品点击 → 关界面）=====
  {
    do: "wait_gui_item",
    label: "等界面出现物品",
    fields: [
      { k: "item", label: "物品名关键词", type: "text" },
      { k: "timeout", label: "超时(秒,默10)", type: "number" },
    ],
  },
  {
    do: "find_and_click_slot",
    label: "界面找物品并点击",
    fields: [
      { k: "item", label: "名字/Lore关键词", type: "text" },
      { k: "button", label: "按键", type: "select", options: BTN_OPTS },
      { k: "matchLore", label: "也搜Lore(领取常看lore)", type: "bool" },
      { k: "save_slot", label: "命中槽存变量(可空)", type: "text" },
    ],
  },
  {
    // 固定槽位号在不同服务器/翻页菜单里很容易点错——推荐用上面「界面找物品并点击」。保留备用，归入高级。
    do: "click_slot",
    label: "点击界面槽位(按号,易错)",
    fields: [
      { k: "slot", label: "槽位号", type: "number" },
      { k: "button", label: "按键", type: "select", options: BTN_OPTS },
    ],
    advanced: true,
  },
  { do: "close_gui", label: "关闭界面", fields: [] },
  // ===== 等待 / 变量 / 地点 =====
  {
    do: "wait_chat",
    label: "等聊天出现",
    fields: [
      { k: "pattern", label: "关键词/正则", type: "text" },
      { k: "timeout", label: "超时(秒,默30)", type: "number" },
    ],
  },
  {
    do: "wait_until",
    label: "等条件成立",
    fields: [
      { k: "cond", label: "条件(如 health<10)", type: "text" },
      { k: "timeout", label: "超时(秒,默60)", type: "number" },
    ],
  },
  {
    do: "set_var",
    label: "设置变量",
    fields: [
      { k: "name", label: "变量名", type: "text" },
      { k: "value", label: "值($health/$x..)", type: "text" },
    ],
  },
  {
    do: "math_var",
    label: "变量运算(计数器)",
    fields: [
      { k: "name", label: "变量名", type: "text" },
      {
        k: "op",
        label: "运算",
        type: "select",
        options: [
          { value: "+", label: "+ 加" },
          { value: "-", label: "- 减" },
          { value: "*", label: "× 乘" },
          { value: "/", label: "÷ 除" },
          { value: "%", label: "% 取余" },
        ],
      },
      { k: "value", label: "操作数", type: "number" },
    ],
  },
  {
    do: "goto_location",
    label: "前往保存地点(自动执行前置/到达脚本)",
    fields: [{ k: "name", label: "地点名", type: "text" }],
  },
  // ===== 控制块（含子步骤） =====
  {
    do: "if",
    label: "如果…则…",
    fields: [{ k: "cond", label: "条件", type: "text" }],
    containers: [
      { key: "then", label: "则（满足时执行）" },
      { key: "else", label: "否则" },
    ],
  },
  {
    do: "repeat",
    label: "重复 N 次",
    fields: [{ k: "times", label: "次数", type: "number" }],
    containers: [{ key: "steps", label: "循环体" }],
  },
  {
    do: "while",
    label: "当…循环",
    fields: [{ k: "cond", label: "条件", type: "text" }],
    containers: [{ key: "steps", label: "循环体" }],
  },
  { do: "break_if", label: "满足则跳出", fields: [{ k: "cond", label: "条件", type: "text" }] },
  { do: "stop", label: "停止脚本", fields: [] },
  { do: "run_script", label: "调用子脚本", fields: [{ k: "name", label: "脚本名", type: "text" }] },
];

export const STEP_MAP: Record<string, StepTypeDef> = Object.fromEntries(
  STEP_TYPES.map((s) => [s.do, s]),
);

export interface TriggerTypeDef {
  type: string;
  label: string;
  valueLabel?: string;
  valuePlaceholder?: string;
}

export const TRIGGER_TYPES: TriggerTypeDef[] = [
  { type: "manual", label: "手动触发" },
  { type: "interval", label: "定时循环(秒)", valueLabel: "间隔秒数", valuePlaceholder: "60" },
  { type: "schedule", label: "定时(HH:MM)", valueLabel: "时刻", valuePlaceholder: "08:00" },
  { type: "chat_match", label: "聊天匹配", valueLabel: "关键词", valuePlaceholder: "tpa" },
  { type: "health_below", label: "血量低于", valueLabel: "阈值", valuePlaceholder: "10" },
  { type: "food_below", label: "饱食低于", valueLabel: "阈值", valuePlaceholder: "10" },
  { type: "mob_nearby", label: "敌对生物靠近", valueLabel: "距离(格)", valuePlaceholder: "8" },
  { type: "damage", label: "受到伤害时" },
  { type: "respawn", label: "重生时" },
  { type: "player_nearby", label: "玩家靠近" },
  { type: "inventory_full", label: "背包满" },
];
