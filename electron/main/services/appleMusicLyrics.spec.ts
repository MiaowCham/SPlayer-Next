import type { Track } from "@shared/types/player";
import { describe, expect, it } from "vitest";
import {
  buildAppleMusicLyricQuery,
  normalizeAppleMusicText,
  pickAppleMusicSong,
  type AppleMusicSong,
} from "./appleMusicLyricsUtils";

const track: Track = {
  id: "track-1",
  source: "local",
  title: "Song Name (Live)",
  artists: [{ name: "The Artist" }],
  duration: 180_000,
};

const song = (overrides: Partial<AppleMusicSong>): AppleMusicSong => ({
  id: "apple-1",
  title: "Song Name (Live)",
  artist: "The Artist",
  duration: 180_500,
  isrc: "US-XXX-01",
  storefront: "us",
  hasTimeSyncedLyrics: false,
  ...overrides,
});

describe("Apple Music TTML 歌词来源", () => {
  it("归一化匹配文本时忽略全半角、空白和标点", () => {
    expect(normalizeAppleMusicText("Ｓong　Name！")).toBe("songname");
  });

  it("优先选择曲名、歌手和时长均匹配的候选", () => {
    const selected = pickAppleMusicSong(track, [
      song({ id: "other", title: "Another Song", artist: "The Artist" }),
      song({ id: "matched" }),
      song({ id: "wrong-duration", duration: 240_000 }),
    ]);

    expect(selected?.id).toBe("matched");
  });

  it("拒绝只有弱相似度的候选", () => {
    expect(
      pickAppleMusicSong(track, [
        song({ title: "Song", artist: "Another Artist", duration: 240_000 }),
      ]),
    ).toBeNull();
  });

  it("按匹配容错档位调整候选接受阈值", () => {
    const candidate = song({ title: "Song", artist: "Another Artist", duration: 240_000 });

    expect(pickAppleMusicSong(track, [candidate], "strict")).toBeNull();
    expect(pickAppleMusicSong(track, [candidate], "standard")).toBeNull();
    expect(pickAppleMusicSong(track, [candidate], "loose")?.id).toBe(candidate.id);
  });

  it("生成包含本地化语言与自动脚本的歌词参数", () => {
    expect(buildAppleMusicLyricQuery("zh-Hans-CN", "")).toBe(
      "extend=ttmlLocalizations&l%5Blyrics%5D=zh-Hans-CN&l%5Bscript%5D=zh-Hans",
    );
  });
});
