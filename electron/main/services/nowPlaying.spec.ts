import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";

vi.mock("@main/store", () => ({ store: { get: () => ({}), set: vi.fn() } }));

describe("交接后的歌词窗口锚点", () => {
  beforeEach(() => vi.resetModules());

  it("设备延迟独立广播并包含在所有快照中，切歌或清空不会丢失", async () => {
    const service = await import("./nowPlaying");
    service.update({ id: "song" } as Track, [], null);
    service.onPosition(4000, false);
    service.setLyricOffset("song", 150);
    const changed = vi.fn();
    const unsubscribe = service.onDeviceLatencyChange(changed);
    service.setDeviceLatency(200.4);
    service.setDeviceLatency(200);
    expect(changed).toHaveBeenCalledExactlyOnceWith(200);
    for (const snap of [service.snapshot(), service.lightSnapshot(), service.lyricSnapshot()]) {
      expect(snap).toMatchObject({ lyricOffsetMs: 150, deviceLatencyMs: 200 });
    }
    expect(service.snapshot().position).toBe(4000);
    service.clear();
    expect(service.snapshot()).toMatchObject({ deviceLatencyMs: 200, lyricOffsetMs: 0 });
    unsubscribe();
    service.setDeviceLatency(300);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("等新曲歌词到达再采用引擎锚点，后续歌词更新不覆盖新进度", async () => {
    const service = await import("./nowPlaying");
    service.update({ id: "old" } as Track, [], null);
    service.prepareTransition("next", {
      position: 2400,
      state: "playing",
      speed: 1.5,
      timestamp: 12345,
    });
    expect(service.snapshot().track?.id).toBe("old");
    service.update({ id: "next" } as Track, [], null);
    expect(service.snapshot()).toMatchObject({
      position: 2400,
      speed: 1.5,
      sendTimestamp: 12345,
      playing: true,
    });
    service.onPosition(3000, true);
    service.update({ id: "next" } as Track, [], null);
    expect(service.snapshot().position).toBe(3000);
  });

  it("暂停的交接不会把歌词窗口恢复为播放态", async () => {
    const service = await import("./nowPlaying");
    service.prepareTransition("next", {
      position: 1700,
      state: "paused",
      speed: 1,
      timestamp: 12345,
    });
    service.update({ id: "next" } as Track, [], null);
    expect(service.snapshot()).toMatchObject({ position: 1700, playing: false, state: "paused" });
  });
});
