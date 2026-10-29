import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { getDeviceLatency, setDeviceLatencyOverride } from "./deviceLatency";
import { getPresentationTime, normalizeDeviceLatency } from "@shared/utils/presentationTime";

const state = vi.hoisted(() => ({
  player: {} as {
    deviceLatencyDefault: number;
    deviceLatencies: Record<string, { latencyMs: number; updatedAt: number }>;
  },
}));
vi.mock("@/stores/settings", () => ({ useSettingsStore: () => state }));

beforeEach(() => {
  state.player = reactive({ deviceLatencyDefault: 120, deviceLatencies: {} });
});

describe("设备延迟与歌词偏移", () => {
  it("未配置时继承默认值，独立零值不会被默认值覆盖", () => {
    expect(getDeviceLatency(null)).toBe(120);
    expect(getDeviceLatency("speaker")).toBe(120);
    setDeviceLatencyOverride("speaker", 0);
    expect(getDeviceLatency("speaker")).toBe(0);
    state.player.deviceLatencyDefault = 200;
    expect(getDeviceLatency("speaker")).toBe(0);
    expect(getDeviceLatency("bluetooth")).toBe(200);
    setDeviceLatencyOverride("speaker", null);
    expect(getDeviceLatency("speaker")).toBe(200);
  });

  it("只保留最近配置的三十个设备", () => {
    for (let index = 0; index < 35; index++) {
      vi.spyOn(Date, "now").mockReturnValue(index);
      setDeviceLatencyOverride(`device-${index}`, index);
    }
    expect(Object.keys(state.player.deviceLatencies)).toHaveLength(30);
    expect(state.player.deviceLatencies).not.toHaveProperty("device-0");
    expect(getDeviceLatency("device-34")).toBe(34);
  });

  it("归一化为非负整数，不让非法输入污染时间线", () => {
    expect(normalizeDeviceLatency(-30)).toBe(0);
    expect(normalizeDeviceLatency(12.6)).toBe(13);
    expect(normalizeDeviceLatency(Infinity)).toBe(0);
    expect(normalizeDeviceLatency(NaN)).toBe(0);
  });

  it("设备延迟使歌词延后，单曲偏移独立叠加，倍速按墙钟补偿", () => {
    expect(getPresentationTime(1000, 100, 200)).toBe(900);
    expect(getPresentationTime(1000, 100, 200, 2)).toBe(700);
    expect(getPresentationTime(1000, -100, 200, 0.5)).toBe(800);
    expect(getPresentationTime(10, 0, 200)).toBe(0);
  });
});
