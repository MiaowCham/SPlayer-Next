import { describe, expect, it } from "vitest";
import { getOverlapAlignPosition } from "./overlapAlign";

describe("getOverlapAlignPosition", () => {
  it("让第二行尽量位于默认对齐位置", () => {
    expect(getOverlapAlignPosition(0.35, 800, 80, 80, 0, 1000)).toBeCloseTo(0.25);
  });

  it("第一行或第二行超出时按边界约束", () => {
    expect(getOverlapAlignPosition(0.05, 800, 80, 80, 0, 1000)).toBeCloseTo(0.05);
    expect(getOverlapAlignPosition(0.95, 800, 80, 80, 0, 1000)).toBeCloseTo(0.85);
  });

  it("短重叠保持默认对齐", () => {
    expect(getOverlapAlignPosition(0.35, 800, 80, 80, 0, 499)).toBe(0.35);
  });

  it("固定间距输入会得到稳定的有限结果", () => {
    const first = getOverlapAlignPosition(0.35, 800, 80, 80, 0, 1000);
    const second = getOverlapAlignPosition(0.35, 800, 80, 80, 0, 1000);
    expect(second).toBe(first);
    expect(Number.isFinite(second)).toBe(true);
  });
});
