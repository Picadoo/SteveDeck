import { describe, it, expect } from "vitest";
import { closestName } from "./closestName";

const ITEMS = ["diamond", "diamond_sword", "dirt", "stone", "cobblestone", "oak_planks"];

describe("closestName", () => {
  it("精确命中返回自身", () => {
    expect(closestName("diamond", ITEMS)).toBe("diamond");
    expect(closestName("stone", ITEMS)).toBe("stone");
  });
  it("大小写不敏感（输入归一小写）", () => {
    expect(closestName("STONE", ITEMS)).toBe("stone");
    expect(closestName("  Diamond  ", ITEMS)).toBe("diamond");
  });
  it("手滑一两个字符 → 最近候选", () => {
    expect(closestName("dimond", ITEMS)).toBe("diamond"); // 少一个 a（距离 1）
    expect(closestName("diamnod", ITEMS)).toBe("diamond"); // o/n 换位（距离 2）
    expect(closestName("stoen", ITEMS)).toBe("stone"); // e/n 换位
  });
  it("差太远 → null（超出容差不硬凑）", () => {
    expect(closestName("xyzzy", ITEMS)).toBeNull();
    expect(closestName("banana", ITEMS)).toBeNull();
  });
  it("空输入 → null", () => {
    expect(closestName("", ITEMS)).toBeNull();
    expect(closestName("   ", ITEMS)).toBeNull();
  });
  it("空候选表 → null", () => {
    expect(closestName("diamond", [])).toBeNull();
  });
});
