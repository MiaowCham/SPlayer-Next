import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent } from "vue";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { getNowPlayingCurrentMs, useNowPlayingSync } from "./useNowPlayingSync";
import type { NowPlayingSnapshot } from "@shared/types/nowPlaying";

let latencyChanged: (value: number) => void;
let offsetChanged: (data: { offsetMs: number }) => void;
const unsubscribers = Array.from({ length: 4 }, () => vi.fn());
let pendingFrames: Map<number, FrameRequestCallback>;
let frameId = 0;
let hidden = false;

beforeEach(() => {
  pendingFrames = new Map();
  hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    pendingFrames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => pendingFrames.delete(id));
  Object.assign(window, {
    api: {
      nowPlaying: {
        requestSnapshot: vi.fn().mockResolvedValue({
          track: null,
          source: null,
          state: "paused",
          lyric: [],
          playing: false,
          speed: 1,
          lyricOffsetMs: 100,
          deviceLatencyMs: 200,
          position: 1000,
          sendTimestamp: Date.now(),
        } as NowPlayingSnapshot),
        onLyricChange: () => unsubscribers[0],
        onPositionSync: () => unsubscribers[1],
        onDeviceLatencyChange: (callback: typeof latencyChanged) => {
          latencyChanged = callback;
          return unsubscribers[2];
        },
        onLyricOffsetChange: (callback: typeof offsetChanged) => {
          offsetChanged = callback;
          return unsubscribers[3];
        },
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

it("暂停时修改设备延迟立即更新歌词时间，隐藏与卸载后没有动画循环", async () => {
  const wrapper = mount(
    defineComponent({
      setup() {
        useNowPlayingSync({ pickIndex: () => -1, logTag: "test" });
        return () => null;
      },
    }),
  );
  await flushPromises();
  expect(getNowPlayingCurrentMs()).toBe(900);
  latencyChanged(350);
  expect(getNowPlayingCurrentMs()).toBe(750);
  offsetChanged({ offsetMs: -50 });
  expect(getNowPlayingCurrentMs()).toBe(600);
  hidden = true;
  document.dispatchEvent(new Event("visibilitychange"));
  expect(pendingFrames.size).toBe(0);
  hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
  expect(pendingFrames.size).toBe(1);
  wrapper.unmount();
  expect(pendingFrames.size).toBe(0);
  unsubscribers.forEach((off) => expect(off).toHaveBeenCalledOnce());
});

it("卸载发生在快照返回前时不再安装订阅", async () => {
  let resolveSnapshot: (snapshot: NowPlayingSnapshot) => void;
  vi.mocked(window.api.nowPlaying.requestSnapshot).mockReturnValue(
    new Promise((resolve) => {
      resolveSnapshot = resolve;
    }),
  );
  const subscribe = vi.spyOn(window.api.nowPlaying, "onDeviceLatencyChange");
  const wrapper = mount(
    defineComponent({
      setup() {
        useNowPlayingSync({ pickIndex: () => -1, logTag: "test" });
        return () => null;
      },
    }),
  );
  wrapper.unmount();
  resolveSnapshot!({ lyric: [] } as unknown as NowPlayingSnapshot);
  await flushPromises();
  expect(subscribe).not.toHaveBeenCalled();
  expect(pendingFrames.size).toBe(0);
});
