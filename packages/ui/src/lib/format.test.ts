import { describe, it, expect } from "vitest";
import { healthPct, healthTone, fmtBig, mcPlain, fmtUptime } from "./format";

describe("healthPct", () => {
  it("按最大生命算百分比（RPG 服可能 >20）", () => {
    expect(healthPct({ health: 20, maxHealth: 20 })).toBe(100);
    expect(healthPct({ health: 10, maxHealth: 20 })).toBe(50);
    expect(healthPct({ health: 40, maxHealth: 40 })).toBe(100);
    expect(healthPct({ health: 0, maxHealth: 20 })).toBe(0);
  });
  it("maxHealth 缺失回退 20；越界夹紧 0-100", () => {
    expect(healthPct({ health: 10, maxHealth: null })).toBe(50);
    expect(healthPct({ health: 30, maxHealth: 20 })).toBe(100);
  });
  it("离线（health null）返回 null", () => {
    expect(healthPct({ health: null, maxHealth: 20 })).toBeNull();
  });
});

describe("healthTone", () => {
  it("分档（>60 成功 / >30 警告 / 其余危险 / null 静音）", () => {
    expect(healthTone(80)).toBe("text-success");
    expect(healthTone(60)).toBe("text-warning"); // 边界：60 不算 >60
    expect(healthTone(50)).toBe("text-warning");
    expect(healthTone(30)).toBe("text-danger"); // 边界：30 不算 >30
    expect(healthTone(10)).toBe("text-danger");
    expect(healthTone(null)).toBe("text-muted");
  });
});

describe("fmtBig", () => {
  it("按中文单位缩写", () => {
    expect(fmtBig(5000)).toBe("5000"); // <1万原样
    expect(fmtBig(1500000)).toBe("150万");
    expect(fmtBig(1.62e10)).toBe("162亿");
    expect(fmtBig(1.2e12)).toBe("1.2万亿");
  });
  it("小数位随大小收敛、去尾零", () => {
    expect(fmtBig(12345)).toBe("1.23万"); // <10 → 两位
    expect(fmtBig(123456)).toBe("12.3万"); // <100 → 一位
  });
  it("负数、非有限、null", () => {
    expect(fmtBig(-1500000)).toBe("-150万");
    expect(fmtBig(null)).toBe("—");
    expect(fmtBig(undefined)).toBe("—");
    expect(fmtBig(Infinity)).toBe("—");
  });
});

describe("mcPlain", () => {
  it("去 § 与 & 色码/格式码", () => {
    expect(mcPlain("§a金币§r")).toBe("金币");
    expect(mcPlain("&c红")).toBe("红");
    expect(mcPlain("§x§1§2§3§4§5§6abc")).toBe("abc"); // §x hex
    expect(mcPlain("§#ff0000红")).toBe("红"); // §#RRGGBB
  });
  it("& 只认标准码，非法码字母保留", () => {
    expect(mcPlain("&z保留")).toBe("&z保留");
  });
  it("对 null/undefined 安全", () => {
    expect(mcPlain(null)).toBe("");
    expect(mcPlain(undefined)).toBe("");
    expect(mcPlain("plain")).toBe("plain");
  });
});

describe("fmtUptime", () => {
  it("按最大单位对显示两级", () => {
    expect(fmtUptime(90061)).toBe("1天1时");
    expect(fmtUptime(3720)).toBe("1时2分");
    expect(fmtUptime(510)).toBe("8分30秒");
    expect(fmtUptime(45)).toBe("45秒");
  });
  it("null / 负数 → —", () => {
    expect(fmtUptime(null)).toBe("—");
    expect(fmtUptime(-5)).toBe("—");
  });
});
