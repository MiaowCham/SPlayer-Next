import { createApp } from "vue";
import { createPinia, disposePinia, setActivePinia, type Pinia } from "pinia";
import persistedstate from "pinia-plugin-persistedstate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "./settings";

let pinia: Pinia;
beforeEach(() => {
  Object.assign(window, {
    api: {
      desktopLyric: { onConfigChange: vi.fn(() => () => {}) },
      dynamicIsland: { onConfigChange: vi.fn(() => () => {}) },
      window: {
        onDesktopLyricVisibilityChange: vi.fn(() => () => {}),
        onDynamicIslandVisibilityChange: vi.fn(() => () => {}),
        onTaskbarLyricVisibilityChange: vi.fn(() => () => {}),
        isDesktopLyricOpen: vi.fn().mockResolvedValue(false),
        isDynamicIslandOpen: vi.fn().mockResolvedValue(false),
        isTaskbarLyricOpen: vi.fn().mockResolvedValue(false),
      },
    },
  });
  pinia = createPinia().use(persistedstate);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});
afterEach(() => {
  disposePinia(pinia);
  localStorage.clear();
});

describe("歌词设置升级", () => {
  it.each([
    { master: true, line: false, word: true, expected: [false, true] },
    { master: true, line: true, word: false, expected: [true, false] },
    { master: false, line: true, word: true, expected: [false, false] },
  ])("保留旧总开关和 AMLL 分项：%j", ({ master, line, word, expected }) => {
    localStorage.setItem(
      "settings",
      JSON.stringify({
        lyric: {
          showRomanization: master,
          amllShowLineRomanization: line,
          amllShowWordRomanization: word,
        },
      }),
    );
    const settings = useSettingsStore();
    expect([settings.lyric.showRomanization, settings.lyric.showWordRomanization]).toEqual(
      expected,
    );
    settings.$persist();
    const saved = JSON.parse(localStorage.getItem("settings")!);
    expect(saved.lyric).not.toHaveProperty("amllShowLineRomanization");
    expect(saved.lyric).not.toHaveProperty("amllShowWordRomanization");
    settings.$hydrate();
    expect([settings.lyric.showRomanization, settings.lyric.showWordRomanization]).toEqual(
      expected,
    );
  });

  it("新版独立开关不会在重新加载时被总开关覆盖", () => {
    localStorage.setItem(
      "settings",
      JSON.stringify({ lyric: { showRomanization: false, showWordRomanization: true } }),
    );
    const settings = useSettingsStore();
    expect(settings.lyric.showRomanization).toBe(false);
    expect(settings.lyric.showWordRomanization).toBe(true);
  });
});
