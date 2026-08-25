import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SettingCategory } from "@/types/settings-schema";

const settings = {
  lyric: { engine: "amll" },
};

vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => settings,
}));

let lyricCategory: SettingCategory;

beforeAll(async () => {
  Object.defineProperty(window, "api", {
    configurable: true,
    value: { system: { platform: "win32" } },
  });
  lyricCategory = (await import("./lyric")).default;
});

describe("歌词设置", () => {
  const topLevelItems = () =>
    (lyricCategory.sections ?? []).flatMap((section) => section.items ?? []);

  it("不再重复展示已迁移的歌词时间线实验项", () => {
    const migratedKeys = new Set([
      "largerLyricText",
      "forceLinePronunciationAsMain",
      "maxHighlightedLines",
      "earlyEndMode",
      "lineSelectionPreference",
    ]);

    expect(topLevelItems().filter((item) => migratedKeys.has(item.key))).toHaveLength(0);
  });

  it("翻译与发音分区不再重复展示独立发音进度", () => {
    const section = lyricCategory.sections?.find(
      (item) => item.id === "lyricTranslationPronunciation",
    );
    expect(section?.items.some((item) => item.key === "independentWordRomanizationProgress")).toBe(
      false,
    );
  });

  it("多行同亮对齐仍保留在显示效果分区", () => {
    const section = lyricCategory.sections?.find((item) => item.id === "lyricDisplay");
    expect(section?.items.at(-1)).toMatchObject({
      key: "raiseAlignPositionOnOverlap",
      tag: { text: "Beta" },
    });
  });
});
