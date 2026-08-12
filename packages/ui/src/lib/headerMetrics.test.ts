import { describe, it, expect } from "vitest";
import {
  extractNumber,
  labelKey,
  cleanLine,
  detectFromScoreboard,
  computeMetrics,
  defaultCfg,
  type HeaderCfg,
} from "./headerMetrics";
import type { BotSummary } from "@mcbot/protocol";

// 只构造 computeMetrics 实际读取的字段（health/maxHealth/food/level/ping/pos）
function mockBot(over: Partial<BotSummary> = {}): BotSummary {
  return {
    health: 20,
    maxHealth: 20,
    food: 18,
    level: 30,
    ping: 45,
    pos: { x: 1, y: 64, z: -2 },
    ...over,
  } as unknown as BotSummary;
}

describe("extractNumber", () => {
  it("抽第一个数字，支持千分位（中英文逗号）与小数", () => {
    expect(extractNumber("金币: 1,234")?.value).toBe(1234);
    expect(extractNumber("点券 1，500")?.value).toBe(1500); // 全角逗号
    expect(extractNumber("倍率 2.5")?.value).toBe(2.5);
    expect(extractNumber("-50")?.value).toBe(-50);
  });
  it("中文单位换算", () => {
    expect(extractNumber("战力 5.2万")?.value).toBe(52000);
    expect(extractNumber("资产 162.41亿")?.value).toBeCloseTo(1.6241e10, 0);
    expect(extractNumber("1.2万亿")?.value).toBeCloseTo(1.2e12, 0);
  });
  it("无数字返回 null；给出匹配区间", () => {
    expect(extractNumber("纯文本无数字")).toBeNull();
    const r = extractNumber("金币 888");
    expect(r).not.toBeNull();
    expect("金币 888".slice(r!.start, r!.end)).toContain("888");
  });
});

describe("labelKey", () => {
  it("去掉数字片段 + 首尾分隔符，得到稳定标签", () => {
    expect(labelKey("金币: 1234")).toBe("金币");
    expect(labelKey("点券 ｜ 50万")).toBe("点券 ｜"); // 半角分隔才剥，全角竖线保留
    expect(labelKey("战力 > 999")).toBe("战力");
  });
  it("纯数字行 → 空键（调用方据此跳过）", () => {
    expect(labelKey("888")).toBe("");
    expect(labelKey("1,000")).toBe("");
  });
});

describe("cleanLine", () => {
  it("去色码并压缩空白", () => {
    expect(cleanLine("§a金币§r:   1234")).toBe("金币: 1234");
    expect(cleanLine("  §b点券  ")).toBe("点券");
  });
});

describe("detectFromScoreboard", () => {
  it("抽出含数字的行、跳过无数字/纯数字行", () => {
    const out = detectFromScoreboard(["§e金币: 1,000", "§b点券: 50", "纯文本", "888"]);
    expect(out.map((o) => o.label)).toEqual(["金币", "点券"]);
    expect(out[0].value).toBe("1000");
    expect(out[1].value).toBe("50");
  });
  it("同标签多行用 #n 消歧，不塌成一个键", () => {
    const out = detectFromScoreboard(["队伍 3", "队伍 5"]);
    expect(out.map((o) => o.labelKey)).toEqual(["队伍", "队伍#2"]);
    expect(out.map((o) => o.label)).toEqual(["队伍", "队伍"]); // 显示名不带后缀
  });
});

describe("computeMetrics", () => {
  it("默认配置产出 5 个内置指标卡", () => {
    const chips = computeMetrics(mockBot(), [], defaultCfg());
    expect(chips.map((c) => c.label)).toEqual(["生命", "饱食", "等级", "延迟", "坐标"]);
    const byLabel = Object.fromEntries(chips.map((c) => [c.label, c.value]));
    expect(byLabel["生命"]).toBe("100%");
    expect(byLabel["延迟"]).toBe("45ms");
    expect(byLabel["坐标"]).toBe("1, 64, -2");
  });
  it("钉住的自定义指标按 labelKey 从当前计分板取值", () => {
    const cfg: HeaderCfg = { builtins: { health: false, food: false, level: false, ping: false, pos: false }, pinned: [{ labelKey: "金币", label: "金币" }] };
    const chips = computeMetrics(mockBot(), ["§e金币: 5万"], cfg);
    expect(chips).toHaveLength(1);
    expect(chips[0].value).toBe("5万");
  });
  it("钉住项在当前计分板缺失时显示占位", () => {
    const cfg: HeaderCfg = { builtins: { health: false, food: false, level: false, ping: false, pos: false }, pinned: [{ labelKey: "金币", label: "金币" }] };
    const chips = computeMetrics(mockBot(), ["点券: 3"], cfg);
    expect(chips[0].value).toBe("—");
  });
});
