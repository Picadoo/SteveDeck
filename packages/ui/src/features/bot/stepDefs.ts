// 可视化脚本步骤的字段 schema（覆盖常用的扁平步骤；if/repeat 等嵌套步骤在 JSON 模式编辑）

export interface StepFieldDef {
  k: string;
  label: string;
  type: "text" | "number";
}
export interface StepTypeDef {
  do: string;
  label: string;
  fields: StepFieldDef[];
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
  {
    do: "goto",
    label: "走到坐标",
    fields: [
      { k: "x", label: "X", type: "number" },
      { k: "y", label: "Y", type: "number" },
      { k: "z", label: "Z", type: "number" },
    ],
  },
  { do: "return_home", label: "回家", fields: [] },
  { do: "equip", label: "装备物品", fields: [{ k: "item", label: "物品名", type: "text" }] },
  { do: "equip_best_weapon", label: "装备最强武器", fields: [] },
  {
    do: "drop",
    label: "丢弃物品",
    fields: [
      { k: "item", label: "物品名", type: "text" },
      { k: "count", label: "数量", type: "number" },
    ],
  },
  { do: "use_item", label: "使用手持物品", fields: [] },
  { do: "attack", label: "攻击实体", fields: [{ k: "entity", label: "实体名", type: "text" }] },
  { do: "jump", label: "跳跃", fields: [] },
  { do: "swap_hands", label: "切换副手", fields: [] },
  {
    do: "look",
    label: "看向坐标",
    fields: [
      { k: "x", label: "X", type: "number" },
      { k: "y", label: "Y", type: "number" },
      { k: "z", label: "Z", type: "number" },
    ],
  },
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
  { type: "respawn", label: "重生时" },
  { type: "player_nearby", label: "玩家靠近" },
  { type: "inventory_full", label: "背包满" },
];
