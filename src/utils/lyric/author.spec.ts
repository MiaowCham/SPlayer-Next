import { describe, expect, it } from "vitest";
import { extractNeteaseCreators } from "./author";

describe("lyric author", () => {
  it("合并 API 歌手与创作者并过滤无效占位内容", () => {
    expect(
      extractNeteaseCreators({
        data: {
          artistRepVos: [{ artistName: "歌手" }, { artistName: "无" }],
          lyricArtists: [{ artistName: "暂无" }, { artistName: "作词" }],
          composeArtists: [{ artistName: "Unknown" }, { artistName: "作曲" }],
          arrangeArtists: [{ artistName: "歌手" }],
        },
      }),
    ).toEqual(["歌手", "作词", "作曲"]);
  });
});
