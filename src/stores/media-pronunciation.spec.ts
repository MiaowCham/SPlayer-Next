import { createPinia, setActivePinia } from "pinia";
import { nextTick, reactive } from "vue";
import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LyricLine } from "@shared/types/lyrics";

let settings: {
  locale: string;
  lyric: {
    chineseScriptPreference: string;
    hideChinesePronunciation: boolean;
    llmTranslation: boolean;
    pronunciationOptimization: "off" | "llm" | "dictionary";
  };
  preset: { uncensorProfanity: boolean };
};
const mocks = vi.hoisted(() => ({
  filter: vi.fn(),
  sync: vi.fn(),
  parse: vi.fn(),
  enhance: vi.fn(),
}));
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
    lyric: {
      chineseScriptPreference: "default",
      hideChinesePronunciation: true,
      llmTranslation: false,
      pronunciationOptimization: "off",
    },
    preset: { uncensorProfanity: false },
  });
  vi.stubGlobal("api", {});
  Object.defineProperty(window, "api", {
    configurable: true,
    value: { nowPlaying: { update: mocks.sync }, lyricEnhancement: { enhance: mocks.enhance } },
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

describe("歌词异步增强", () => {
  const enhanced: LyricLine[] = [
    {
      ...raw[0],
      translatedLyric: "Hello",
      generatedTranslation: { method: "llm", language: "en-US" },
    },
  ];
  let complete: (result: { lines: LyricLine[]; warnings: string[] }) => void;
  beforeEach(() => {
    settings.lyric.hideChinesePronunciation = false;
    settings.lyric.llmTranslation = true;
    settings.locale = "en-US";
    mocks.enhance.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
  });

  it("先显示原歌词，增强完成同步所有歌词窗口并保留原文件", async () => {
    store.setLyric(
      { source: "managed", format: "lrc", versionId: "version-a" },
      { content: "original" },
    );
    expect(store.parsedLyric[0].translatedLyric).toBe("");
    expect(store.lyricLoading).toBe(false);
    expect(store.lyricEnhancementPending).toBe(true);
    expect(mocks.enhance.mock.lastCall![0]).toMatchObject({
      locale: "en-US",
      translate: true,
      pronunciation: "off",
    });
    expect(mocks.enhance.mock.lastCall![0].versionKey).toContain("version-a");
    complete({ lines: enhanced, warnings: [] });
    await flushPromises();
    expect(store.parsedLyric).toEqual(enhanced);
    expect(mocks.sync.mock.lastCall![0].lyric).toEqual(enhanced);
    expect(store.lyricContent?.content).toBe("original");
    expect(store.lyricEnhancementPending).toBe(false);
  });

  it.each(["clear", "resetLyricState"] as const)(
    "%s 后增强结果不会重新点亮旧歌词",
    async (action) => {
      store.setLyric({ source: "external", format: "lrc" }, { content: "original" });
      store[action]();
      complete({ lines: enhanced, warnings: [] });
      await flushPromises();
      expect(store.parsedLyric).toEqual([]);
      expect(store.lyricEnhancementPending).toBe(false);
    },
  );

  it("关闭功能恢复原文并丢弃在途增强", async () => {
    store.setLyric({ source: "external", format: "lrc" }, { content: "original" });
    settings.lyric.llmTranslation = false;
    await nextTick();
    complete({ lines: enhanced, warnings: [] });
    await flushPromises();
    expect(store.parsedLyric[0].translatedLyric).toBe("");
    expect(store.lyricEnhancementPending).toBe(false);
  });

  it("切歌使旧结果失效", async () => {
    store.setLyric({ source: "external", format: "lrc" }, { content: "original" });
    store.setTrack({ id: "next", source: "local", title: "next", artists: [], duration: 1000 });
    complete({ lines: enhanced, warnings: [] });
    await flushPromises();
    expect(store.parsedLyric[0].translatedLyric).toBe("");
    expect(store.parsedLyric[0].generatedTranslation).toBeUndefined();
    expect(store.lyricEnhancementPending).toBe(false);
  });

  it("增强失败保留原歌词并提供可见错误状态", async () => {
    mocks.enhance.mockRejectedValueOnce(new Error("offline"));
    store.setLyric({ source: "external", format: "lrc" }, { content: "original" });
    await flushPromises();
    expect(store.parsedLyric[0].translatedLyric).toBe("");
    expect(store.lyricEnhancementWarnings.length).toBe(1);
    expect(store.lyricEnhancementPending).toBe(false);
  });

  it("增强后继续应用发音隐藏，避免跨窗口泄露隐藏拼音", async () => {
    settings.lyric.hideChinesePronunciation = true;
    mocks.filter.mockResolvedValue(filtered);
    store.setLyric({ source: "external", format: "lrc" }, { content: "original" });
    await flushPromises();
    expect(store.parsedLyric[0].romanLyric).toBe("");
    complete({ lines: enhanced, warnings: [] });
    await flushPromises();
    expect(mocks.filter).toHaveBeenLastCalledWith(enhanced);
    expect(store.parsedLyric[0].romanLyric).toBe("");
  });
});
