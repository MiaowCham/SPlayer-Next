import { beforeEach, describe, expect, it, vi } from "vitest";
import { callQQMusic } from "@main/apis/qqmusic";
import { getCachedLyric, setCachedLyric } from "@main/database/lyricCache";
import { getByPlatformId } from "./qqmusic";

vi.mock("@main/apis/qqmusic", () => ({ callQQMusic: vi.fn() }));
vi.mock("@main/database/lyricCache", () => ({ getCachedLyric: vi.fn(), setCachedLyric: vi.fn() }));
vi.mock("@main/database/lyricMatchCache", () => ({
  buildFingerprint: vi.fn(),
  getMatchedId: vi.fn(),
  setMatchedId: vi.fn(),
}));
vi.mock("@main/utils/logger", () => ({ coreLog: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("./ttml", () => ({ prefetchTTML: vi.fn() }));

beforeEach(() => vi.mocked(getCachedLyric).mockReturnValue(null));

describe("QQ 音译格式", () => {
  it.each([
    { qrc: "[1000,1000]你(1000,500)好(1500,500)", roma: "[00:01.00]ni hao", expected: "lrc" },
    {
      lrc: "[00:01.00]你好",
      roma: '<QrcInfos><LyricInfo><Lyric_1 LyricContent="[1000,1000]ni (1000,500)hao (1500,500)"/></LyricInfo></QrcInfos>',
      expected: "qrc",
    },
    {
      qrc: "[1000,1000]你(1000,500)好(1500,500)",
      roma: "[1000,1000]ni (1000,500)hao (1500,500)",
      expected: "qrc",
    },
  ])("根据音译内容识别格式：$expected", async ({ qrc, lrc, roma, expected }) => {
    vi.mocked(callQQMusic).mockResolvedValue({ code: 200, qrc, lrc, roma });
    const result = await getByPlatformId("123");
    expect(result?.romajiFormat).toBe(expected);
    expect(result?.romaji).toBe(roma);
    expect(setCachedLyric).toHaveBeenCalledWith("qqmusic", "123", result);
  });

  it("修正已有缓存中随主歌词误标的发音格式", async () => {
    vi.mocked(getCachedLyric).mockReturnValue({
      platform: "qqmusic",
      format: "qrc",
      content: "[1000,1000]你(1000,500)好(1500,500)",
      romaji: "[00:01.00]ni hao",
      romajiFormat: "qrc",
    });
    const result = await getByPlatformId("123");
    expect(result?.romajiFormat).toBe("lrc");
    expect(callQQMusic).not.toHaveBeenCalled();
  });
});
