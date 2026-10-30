import { describe, expect, it } from "vitest";
import {
  lyricMatchQuality,
  lyricSourceOffset,
  parseLyricSourceId,
} from "@shared/utils/lyricSource";
import type { Track } from "@shared/types/player";

describe("歌词来源标签与指定版本解析", () => {
  it("匹配度仅依据已知元数据，不把未知来源标为完美", () => {
    const track = { title: "Song", artists: [{ name: "Artist" }], duration: 200000 } as Track;
    expect(lyricMatchQuality(track)).toBe("unknown");
    expect(
      lyricMatchQuality(track, { id: "1", title: "Song", artists: ["Artist"], duration: 200100 }),
    ).toBe("perfect");
    expect(
      lyricMatchQuality(track, { id: "1", title: "Song", artists: ["Artist"], duration: 0 }),
    ).toBe("high");
    expect(
      lyricMatchQuality(track, { id: "1", title: "Other", artists: ["Other"], duration: 50000 }),
    ).toBe("low");
    expect(lyricSourceOffset({ content: "[offset:-200]\n[00:01]word" })).toBe(-200);
  });
  it.each([
    ["netease", "https://music.163.com/#/song?id=123", "123"],
    ["qqmusic", "https://y.qq.com/n/ryqq_v2/songDetail/001qvvgF38HVc4", "001qvvgF38HVc4"],
    ["appleMusic", "https://music.apple.com/us/album/title/123?i=456", "456"],
    ["netease", "https://example.com/song?id=123", null],
    ["qqmusic", "https://music.163.com/#/song?id=123", null],
  ] as const)("%s 仅解析对应官方来源", (origin, input, expected) => {
    expect(parseLyricSourceId({ origin }, input)).toBe(expected);
  });
});
