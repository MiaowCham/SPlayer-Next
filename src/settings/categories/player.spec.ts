import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SettingCategory, SettingItem } from "@/types/settings-schema";

const settings = {
  experimental: { enabled: false },
  player: { playerBgType: "blur", appleMusicBgEnabled: false },
};

vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => settings,
}));

vi.mock("@/components/settings/custom/DeviceSelector.vue", () => ({
  default: {},
}));

let playerCategory: SettingCategory;
let backgroundItem: SettingItem;

beforeAll(async () => {
  playerCategory = (await import("./player")).default;
  backgroundItem = playerCategory.sections
    ?.flatMap((section) => section.items)
    .find((item) => item.key === "playerBgType") as SettingItem;
});

describe("播放器背景设置", () => {
  it("仅在实验开关启用时提供 Apple Music 背景", () => {
    const appleMusicOptions = backgroundItem.options?.filter((option) =>
      String(option.value).startsWith("apple-music-"),
    );

    expect(appleMusicOptions).toHaveLength(2);
    expect(appleMusicOptions?.every((option) => option.visible?.() === false)).toBe(true);
    settings.player.appleMusicBgEnabled = true;
    expect(appleMusicOptions?.every((option) => option.visible?.() === false)).toBe(true);
    settings.experimental.enabled = true;
    expect(appleMusicOptions?.every((option) => option.visible?.() === true)).toBe(true);
  });

  it("播放器页只保留流体背景控制项", () => {
    expect(backgroundItem.children?.map((item) => item.key)).toEqual([
      "playerBgFlowSpeed",
      "playerBgRenderScale",
      "playerBgFps",
      "playerBgFreezeOnPause",
      "playerBgBeat",
    ]);
    settings.player.playerBgType = "animation";
    expect(backgroundItem.childrenCondition?.()).toBe(true);
    settings.player.playerBgType = "apple-music-dev";
    expect(backgroundItem.childrenCondition?.()).toBe(false);
  });

  it("歌词拖动跟随保留在播放器分区末尾", () => {
    const playback = playerCategory.sections?.find((section) => section.id === "playback");
    expect(playback?.items.at(-1)).toMatchObject({
      key: "followLyricOnProgressDrag",
      tag: { text: "Beta" },
    });
  });
});
