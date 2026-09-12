import { createPinia, setActivePinia } from "pinia";
import { nextTick, reactive } from "vue";
import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LyricLine } from "@shared/types/lyrics";

let settings: {
  locale: string;
  lyric: { chineseScriptPreference: string; hideChinesePronunciation: boolean };
  preset: { uncensorProfanity: boolean };
};
const mocks = vi.hoisted(() => ({ filter: vi.fn(), sync: vi.fn(), parse: vi.fn() }));
vi.mock("@/stores/settings", () => ({ useSettingsStore: () => settings }));
vi.mock("@/stores/user", () => ({ useUserStore: () => ({ isLoggedIn: false }) }));
vi.mock("@/services/lyric/loader", () => ({ watchLyricPreference: vi.fn() }));
vi.mock("@/utils/lyric/parse", () => ({ parseLyric: mocks.parse }));
vi.mock("@/utils/lyric/lyricStripper", () => ({
  applyLyricExclude: (lines: LyricLine[]) => lines,
}));
vi.mock("@/utils/lyric/hideChinesePronunciation", () => ({
  hideChinesePronunciation: mocks.filter,
}));
vi.mock("@/utils/lyric/cjkTransform", () => ({
  applyLyricCjkTransform: async (lines: LyricLine[]) => lines,
}));
vi.mock("@/apis/netease", () => ({ neteaseCall: vi.fn() }));
import { useMediaStore } from "./media";

let store: ReturnType<typeof useMediaStore>;
const raw: LyricLine[] = [
  {
    words: [{ word: "你好", startTime: 0, endTime: 1000 }],
    romanLyric: "ni hao",
    translatedLyric: "",
    startTime: 0,
    endTime: 1000,
    isBG: false,
    isDuet: false,
  },
];
const filtered: LyricLine[] = [{ ...raw[0], romanLyric: "" }];
let resolveFilter: (lines: LyricLine[]) => void;

beforeEach(() => {
  setActivePinia(createPinia());
  settings = reactive({
    locale: "zh-CN",
    lyric: { chineseScriptPreference: "default", hideChinesePronunciation: true },
    preset: { uncensorProfanity: false },
  });
  vi.stubGlobal("api", {});
  Object.defineProperty(window, "api", {
    configurable: true,
    value: { nowPlaying: { update: mocks.sync } },
  });
  mocks.parse.mockImplementation(() => structuredClone(raw));
  mocks.filter.mockImplementation(
    () =>
      new Promise<LyricLine[]>((resolve) => {
        resolveFilter = resolve;
      }),
  );
  store = useMediaStore();
});
afterEach(() => {
  store.$dispose();
  vi.unstubAllGlobals();
});

describe("拼音过滤与媒体同步", () => {
  it("首屏不广播未过滤拼音，过滤完成后同步所有歌词窗口", async () => {
    store.setLyric({ source: "external", format: "lrc" }, { content: "raw lyric" });
    expect(store.parsedLyric).toEqual([]);
    expect(store.lyricLoading).toBe(true);
    expect(mocks.sync.mock.lastCall![0].lyric).toEqual([]);
    resolveFilter(filtered);
    await flushPromises();
    expect(store.parsedLyric).toEqual(filtered);
    expect(mocks.sync.mock.lastCall![0].lyric).toEqual(filtered);
    expect(store.lyricContent?.content).toBe("raw lyric");
    expect(store.lyricLoading).toBe(false);
  });

  it("关闭选项从原始内容恢复，迟到的过滤不能覆盖恢复结果", async () => {
    store.setLyric({ source: "external", format: "lrc" }, { content: "raw lyric" });
    settings.lyric.hideChinesePronunciation = false;
    await nextTick();
    expect(store.parsedLyric[0].romanLyric).toBe("ni hao");
    resolveFilter(filtered);
    await flushPromises();
    expect(store.parsedLyric[0].romanLyric).toBe("ni hao");
  });

  it.each(["clear", "resetLyricState"] as const)("%s 后丢弃异步旧结果", async (action) => {
    store.setLyric({ source: "external", format: "lrc" }, { content: "raw lyric" });
    store[action]();
    resolveFilter(filtered);
    await flushPromises();
    expect(store.parsedLyric).toEqual([]);
  });

  it("切歌后不把旧歌的异步发音结果同步给新歌", async () => {
    store.setLyric({ source: "external", format: "lrc" }, { content: "raw lyric" });
    store.setTrack({ id: "new", source: "local", title: "new", artists: [], duration: 1000 });
    resolveFilter(filtered);
    await flushPromises();
    expect(store.parsedLyric).toEqual([]);
  });
});
