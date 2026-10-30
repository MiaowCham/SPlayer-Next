import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LyricMatchCandidate } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
const state = vi.hoisted(() => ({
  netease: vi.fn(),
  qq: vi.fn(),
  kugou: vi.fn(),
  ttml: vi.fn(),
  detail: vi.fn(),
  qqDetail: vi.fn(),
  write: vi.fn(),
  setOffset: vi.fn(),
  versions: [] as Array<{ versionId: string; filename: string; importedAt: number }>,
}));
vi.mock("@main/database/lyricMatchCache", () => ({
  buildFingerprint: () => "fingerprint",
  getMatchedId: () => null,
  setMatchedId: vi.fn(),
}));
vi.mock("@main/apis/common/lyric/netease", () => ({ getByPlatformId: state.netease }));
vi.mock("@main/apis/common/lyric/qqmusic", () => ({ getByPlatformId: state.qq }));
vi.mock("@main/apis/common/lyric/kugou", () => ({ getByPlatformId: state.kugou }));
vi.mock("@main/apis/common/lyric/ttml", () => ({ fetchTTML: state.ttml }));
vi.mock("@main/apis/netease", () => ({ callNetease: state.detail }));
vi.mock("@main/apis/qqmusic", () => ({ callQQMusic: state.qqDetail }));
vi.mock("./appleMusicLyrics", () => ({}));
vi.mock("./localLyricRepo", () => ({}));
vi.mock("./nowPlaying", () => ({ getVersionOffset: () => 250, setVersionOffset: state.setOffset }));
vi.mock("@main/database/managedLyrics", () => ({
  getManagedLyric: () => ({ versionId: "previous" }),
  listManagedLyricVersions: () => state.versions,
  setManagedLyric: state.write,
}));
import {
  loadSourceVersion,
  saveSourceVersion,
  resolveLyricSourceMatchId,
} from "./lyricSourceSearch";
const song = { id: "123", mid: "mid", title: "来源歌曲", artists: ["来源歌手"], duration: 2000 };
const track: Track = {
  id: "owner",
  source: "local",
  title: "目标歌曲",
  artists: [],
  duration: 2000,
};
beforeEach(() => {
  state.versions = [];
  state.write.mockImplementation((_track, _input, filename: string) => {
    state.versions = [{ versionId: "saved-uuid", filename, importedAt: 1 }];
  });
});
describe("精确来源搜索版本的读取与保存", () => {
  it("QQ 版本不触发其他歌词提供方或 AMLL 预热", async () => {
    state.qq.mockResolvedValue({ content: "[00:01]source", format: "qrc" });
    const candidate = await loadSourceVersion({ origin: "qqmusic" }, song);
    expect(candidate).toMatchObject({ origin: "qqmusic", sourceTrack: song });
    expect(state.qq).toHaveBeenCalledExactlyOnceWith("123", "mid", false);
    expect(state.netease).not.toHaveBeenCalled();
    expect(state.ttml).not.toHaveBeenCalled();
  });
  it("AMLL 仅按绑定平台的精确 ID 取词", async () => {
    state.ttml.mockResolvedValue("<tt/> ");
    expect(await loadSourceVersion({ origin: "amll", platform: "qqmusic" }, song)).toMatchObject({
      origin: "amll",
      platform: "qqmusic",
    });
    expect(state.ttml).toHaveBeenCalledExactlyOnceWith("qqmusic", ["mid", "123"]);
    expect(state.qq).not.toHaveBeenCalled();
  });
  it("通过 ID 导入时先读取真实曲目元数据，不能套用目标歌曲的标题", async () => {
    state.detail.mockResolvedValue({
      body: { songs: [{ id: 123, name: "真实源标题", ar: [{ name: "实际歌手" }], dt: 2000 }] },
    });
    state.netease.mockResolvedValue({ content: "[00:01]word", format: "lrc" });
    expect(await loadSourceVersion({ origin: "netease" }, "123")).toMatchObject({
      sourceTrack: { title: "真实源标题", artists: ["实际歌手"] },
    });
  });
  it("AMLL 的模糊匹配前置只查询元数据，不下载原始平台歌词", async () => {
    state.qqDetail.mockResolvedValue({
      code: 200,
      songs: [{ id: "123", mid: "mid", name: track.title, artist: "", duration: track.duration }],
    });
    expect(await resolveLyricSourceMatchId("qqmusic", track)).toEqual({ id: "123", mid: "mid" });
    expect(state.qqDetail).toHaveBeenCalledWith(
      "search",
      expect.objectContaining({ keywords: track.title }),
    );
    expect(state.qq).not.toHaveBeenCalled();
    expect(state.netease).not.toHaveBeenCalled();
    expect(state.ttml).not.toHaveBeenCalled();
  });

  it("保存只写入所选来源文件，携带元数据与偏移并等待显式激活", () => {
    const candidate: LyricMatchCandidate = {
      id: "remote",
      origin: "qqmusic",
      platform: "qqmusic",
      filename: "remote.qrc",
      content: "body",
      format: "qrc",
      local: false,
      active: false,
      sourceTrack: song,
      extra: { id: "123", mid: "mid" },
    };
    const saved = saveSourceVersion(track, candidate);
    expect(state.write).toHaveBeenCalledWith(
      track,
      expect.objectContaining({
        sourceTrack: song,
        sourceExtra: candidate.extra,
        sourcePlatform: "qqmusic",
      }),
      "qqmusic-qqmusic-123.qrc",
      "qqmusic",
      false,
    );
    expect(saved).toMatchObject({ id: "saved-uuid", local: true, active: false });
    expect(state.setOffset).toHaveBeenCalledWith(
      track,
      expect.objectContaining({ id: "saved-uuid" }),
      250,
    );
  });
});
