import { describe, expect, it } from "vitest";
import { normalizeLyricEarlyEndMode, normalizePlayerBgType } from "./settings";

describe("播放器背景设置迁移", () => {
  it("将旧版 Apple Music 背景映射到 Dev 实现", () => {
    expect(normalizePlayerBgType("apple-music")).toBe("apple-music-dev");
  });

  it.each(["blur", "solid", "animation", "apple-music-dev", "apple-music-beta"])(
    "保留有效背景类型 %s",
    (type) => {
      expect(normalizePlayerBgType(type)).toBe(type);
    },
  );

  it("无效背景类型回退到模糊背景", () => {
    expect(normalizePlayerBgType("removed-background")).toBe("blur");
  });
});

describe("歌词行提早结束设置迁移", () => {
  it("将旧超级激进档迁移为激进档", () => {
    expect(normalizeLyricEarlyEndMode("super-aggressive")).toBe("aggressive");
  });

  it("无效档位回退为关闭", () => {
    expect(normalizeLyricEarlyEndMode("custom")).toBe("off");
  });
});
