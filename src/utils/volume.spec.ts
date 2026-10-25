import { describe, expect, it } from "vitest";
import { volumeGainToPosition, volumePositionToGain } from "./volume";

/** 把线性增益换算成 dB */
const toDb = (position: number): number => 20 * Math.log10(volumePositionToGain(position));

describe("音量曲线", () => {
  it("静音位置对应零增益", () => {
    expect(volumePositionToGain(0)).toBe(0);
    expect(volumeGainToPosition(0)).toBe(0);
  });

  it("最低档接近静音但未关闭", () => {
    // 位置 1% 约 -59.4 dB，与静音档只差 0.6 dB
    expect(volumePositionToGain(0.01)).toBeCloseTo(0.0011, 4);
    expect(toDb(0.01)).toBeCloseTo(-59.4, 1);
  });

  it("低音量位置仍保持可闻增益", () => {
    // 位置 5% 为 -57 dB、10% 为 -54 dB，落在夜间小音量的可用范围
    expect(volumePositionToGain(0.05)).toBeCloseTo(0.0014, 4);
    expect(volumePositionToGain(0.1)).toBeCloseTo(0.002, 4);
    expect(volumePositionToGain(0.1)).toBeGreaterThan(0.001);
  });

  it("滑块位置与 dB 成线性关系", () => {
    expect(toDb(1)).toBeCloseTo(0, 6);
    expect(toDb(0.5)).toBeCloseTo(-30, 6);
    expect(toDb(0.3) - toDb(0.1)).toBeCloseTo(12, 6);
  });

  it("相邻两格滚轮的 dB 步长一致", () => {
    for (const position of [0.05, 0.25, 0.55, 0.85]) {
      expect(toDb(position + 0.05) - toDb(position)).toBeCloseTo(3, 6);
    }
  });

  it("满音量对应单位增益", () => {
    expect(volumePositionToGain(1)).toBe(1);
    expect(volumeGainToPosition(1)).toBe(1);
  });

  it("位置与增益互为逆映射", () => {
    for (const position of [0.01, 0.2, 0.5, 0.77, 1]) {
      expect(volumeGainToPosition(volumePositionToGain(position))).toBeCloseTo(position, 5);
    }
  });
});
