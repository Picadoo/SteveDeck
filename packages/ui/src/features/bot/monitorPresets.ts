import type { MonitorRule } from "@mcbot/protocol";

let seq = 0;
/** 新规则 id（前端运行时用，无需全局唯一到跨设备） */
export const newRuleId = () => `r${Math.random().toString(36).slice(2, 8)}${seq++}`;

export interface MonitorPreset {
  name: string;
  rules: Omit<MonitorRule, "id">[];
}

// 内置预设：基于真实服务器消息抽取（正则对去色码后的纯文本匹配）。
export const MONITOR_PRESETS: MonitorPreset[] = [
  {
    name: "灵元世纪 (mcly)",
    rules: [
      { label: "金币收入", enabled: true, pattern: "你增加了\\s*([\\d,\\.]+)\\s*金币", numberMode: true, agg: "sum" },
      { label: "击杀金币", enabled: true, pattern: "被你击杀，你获得了\\s*([\\d,\\.]+)\\s*金币", numberMode: true, agg: "sum" },
      { label: "经验收入", enabled: true, pattern: "你获得了\\s*([\\d,\\.]+)[^点]*点经验", numberMode: true, agg: "sum" },
      { label: "灵魂空间(当前)", enabled: true, pattern: "灵魂空间[\\s\\S]*?当前\\s*([\\d,]+)\\s*个", numberMode: true, agg: "last" },
      { label: "灵魂存入数", enabled: true, pattern: "灵魂空间[\\s\\S]*?[Xx](\\d+)", numberMode: true, agg: "sum" },
      { label: "峰值暴击", enabled: true, pattern: "伤害为[:：]\\s*([\\d,\\.]+\\s*[万亿兆]?)", numberMode: true, agg: "max" },
      { label: "击杀数", enabled: true, pattern: "被你击杀", numberMode: false, agg: "count" },
    ],
  },
];

export function instantiatePreset(preset: MonitorPreset): MonitorRule[] {
  return preset.rules.map((r) => ({ ...r, id: newRuleId() }));
}

export function blankRule(): MonitorRule {
  return { id: newRuleId(), label: "", enabled: true, pattern: "", valueGroup: 1, numberMode: true, agg: "sum" };
}
