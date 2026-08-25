import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingCategory, SettingItem } from "@/types/settings-schema";

const afterLocalChange = vi.fn();
const disableExperimentalFeatures = vi.fn();
const settings = {
  experimental: {
    enabled: false,
  },
  player: {
    playerBgType: "blur",
    appleMusicBgEnabled: false,
  },
  lyric: {
    engine: "physics",
    earlyEndMode: "off",
    largerLyricText: "lyrics",
    forceLinePronunciationAsMain: false,
    independentWordRomanizationProgress: false,
    maxHighlightedLines: "unlimited",
    earlyEndAdvanceToNextLine: false,
    lineSelectionPreference: "default",
  },
  afterLocalChange,
  disableExperimentalFeatures,
};

vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => settings,
}));

let experimentalCategory: SettingCategory;

beforeAll(async () => {
  experimentalCategory = (await import("./experimental")).default;
});

beforeEach(() => {
  settings.experimental.enabled = false;
  settings.player.playerBgType = "blur";
  settings.player.appleMusicBgEnabled = false;
  settings.lyric.engine = "physics";
  settings.lyric.earlyEndMode = "off";
  afterLocalChange.mockClear();
  disableExperimentalFeatures.mockClear();
});

const collectItems = (items: SettingItem[]): SettingItem[] =>
  items.flatMap((item) => [item, ...collectItems(item.children ?? [])]);

const findItem = (key: string): SettingItem | undefined =>
  collectItems(experimentalCategory.sections?.flatMap((section) => section.items) ?? []).find(
    (item) => item.key === key,
  );

describe("实验性选项", () => {
  it("默认隐藏并仅在总开关启用后显示", () => {
    expect(experimentalCategory.visible?.()).toBe(false);
    settings.experimental.enabled = true;
    expect(experimentalCategory.visible?.()).toBe(true);
  });

  it("类别与三个分区使用橙色 Dev 徽标", () => {
    expect(experimentalCategory.tag).toEqual({ text: "Dev", type: "warning" });
    expect(experimentalCategory.sections).toHaveLength(3);
    expect(
      experimentalCategory.sections?.every(
        (section) => section.tag?.text === "Dev" && section.tag.type === "warning",
      ),
    ).toBe(true);
  });

  it("迁入的设置项不再各自携带 Beta 徽标", () => {
    const items = collectItems(
      experimentalCategory.sections?.flatMap((section) => section.items) ?? [],
    );
    expect(items.every((item) => item.tag == null)).toBe(true);
  });

  it("关闭 Apple Music 背景时将已选背景回退到流体", () => {
    const toggle = findItem("appleMusicBgEnabled");
    settings.player.playerBgType = "apple-music-beta";

    toggle?.action?.(false);

    expect(settings.player.playerBgType).toBe("animation");
    expect(afterLocalChange).toHaveBeenCalledWith("player.playerBgType", "animation");
  });

  it("关闭实验性选项时将已选 AM 背景回退到流体", () => {
    const toggle = findItem("experimentalFeaturesEnabled");

    toggle?.action?.(false);

    expect(disableExperimentalFeatures).toHaveBeenCalledOnce();
  });

  it("AM 流动速度和跳动幅度上限均为 10", () => {
    expect(findItem("appleMusicBgFlowSpeed")).toMatchObject({
      min: 0.5,
      max: 10,
      defaultValue: 1,
    });
    expect(findItem("appleMusicBgBeatStrength")).toMatchObject({
      min: 0.25,
      max: 10,
      defaultValue: 1,
    });
  });

  it("提早结束关闭时隐藏自定义参数", () => {
    const earlyEndMode = findItem("earlyEndMode");
    expect(earlyEndMode?.childrenCondition?.()).toBe(false);
    settings.lyric.earlyEndMode = "aggressive";
    expect(earlyEndMode?.childrenCondition?.()).toBe(true);
    expect(earlyEndMode?.children?.map((item) => item.key)).toEqual([
      "earlyEndGapThreshold",
      "earlyEndAdvance",
      "earlyEndScrollLead",
      "multiLineOverlapThreshold",
    ]);
    expect(findItem("earlyEndAdvance")).toMatchObject({
      min: 100,
      max: 2000,
      defaultValue: 700,
    });
    expect(findItem("earlyEndScrollLead")).toMatchObject({
      min: 500,
      max: 3000,
      defaultValue: 850,
    });
  });

  it("独立发音进度只在 AMLL 引擎下显示", () => {
    const item = findItem("independentWordRomanizationProgress");
    expect(item?.visible?.()).toBe(false);
    settings.lyric.engine = "amll";
    expect(item?.visible?.()).toBe(true);
  });

  it("歌词分区只包含指定实验项", () => {
    const lyricSection = experimentalCategory.sections?.find(
      (section) => section.id === "experimentalLyric",
    );
    expect(lyricSection?.items.map((item) => item.key)).toEqual([
      "largerLyricText",
      "forceLinePronunciationAsMain",
      "independentWordRomanizationProgress",
      "maxHighlightedLines",
      "earlyEndMode",
      "earlyEndAdvanceToNextLine",
      "lineSelectionPreference",
    ]);
  });
});
