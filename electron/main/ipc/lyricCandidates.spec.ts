import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import type { LyricMatchCandidate } from "@shared/types/lyrics";

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  restoreCache: vi.fn(),
  deleteCache: vi.fn(),
  invalidateTtml: vi.fn(),
  invalidateApple: vi.fn(),
  qq: vi.fn(),
  netease: vi.fn(),
  kugou: vi.fn(),
  ttml: vi.fn(),
  apple: vi.fn(),
  local: vi.fn(),
  removeLocal: vi.fn(),
  refresh: vi.fn(),
  neteaseQuery: vi.fn(),
  qqQuery: vi.fn(),
  kugouQuery: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) =>
      state.handlers.set(name, handler),
  },
  dialog: {},
  shell: {},
}));
vi.mock("@main/services/lyricSourceSearch", () => ({
  resolveLyricSourceMatchId: vi.fn().mockResolvedValue(undefined),
  searchSourceTracks: vi.fn(),
  loadSourceVersion: vi.fn(),
  saveSourceVersion: vi.fn(),
}));
vi.mock("./lyricPreview", () => ({ registerLyricPreviewIpc: vi.fn() }));
vi.mock("@main/services/nowPlaying", () => ({
  getVersionOffset: vi.fn(),
  setVersionOffset: vi.fn(),
}));
vi.mock("@main/apis/common/lyric/netease", () => ({
  getByPlatformId: state.netease,
  getByQuery: state.neteaseQuery,
}));
vi.mock("@main/apis/common/lyric/qqmusic", () => ({
  getByPlatformId: state.qq,
  getByQuery: state.qqQuery,
}));
vi.mock("@main/apis/common/lyric/kugou", () => ({
  getByPlatformId: state.kugou,
  getByQuery: state.kugouQuery,
}));
vi.mock("@main/apis/common/lyric/ttml", () => ({
  fetchTTML: state.ttml,
  invalidateTTMLVersion: state.invalidateTtml,
}));
vi.mock("@main/apis/netease", () => ({}));
vi.mock("@main/database/lyricTtmlCache", () => ({ setCachedTTML: vi.fn() }));
vi.mock("@main/database/lyricCache", () => ({
  setCachedLyric: state.restoreCache,
  deleteLyricVersionCache: state.deleteCache,
}));
vi.mock("@main/services/appleMusicLyrics", () => ({
  fetchAppleMusicTTMLResult: vi.fn().mockResolvedValue({ lyric: null }),
  invalidateAppleMusicLyricVersion: state.invalidateApple,
  refetchAppleMusicLyricVersion: state.apple,
}));
vi.mock("@main/services/appleMusicLyricsToken", () => ({}));
vi.mock("@main/services/localLyricRepo", () => ({
  matchLocalTTML: vi.fn().mockResolvedValue(null),
}));
vi.mock("@main/services/managedLyricImport", () => ({}));
vi.mock("@main/database/lyricMatchCache", () => ({
  buildFingerprint: vi.fn(() => "fingerprint"),
  getMatchedId: vi.fn(() => null),
}));
vi.mock("@main/database/managedLyrics", () => ({
  refreshManagedLyricVersions: state.refresh,
  getManagedLyric: () => null,
  getManagedTrackLyricsDir: () => "unused",
  listManagedLyricVersions: state.local,
  deleteManagedLyricVersion: state.removeLocal,
}));
vi.mock("@main/database/lyricPreferences", () => ({ getTrackLyricPreference: () => null }));
vi.mock("@main/utils/logger", () => ({ coreLog: { warn: vi.fn() } }));
vi.mock("@main/window", () => ({ getMainWindow: () => null }));
vi.mock("@main/database/queries", () => ({}));
vi.mock("@main/database/streaming/tracks", () => ({}));

import { registerLyricsIpc } from "./lyrics";
const track: Track = { id: "track", source: "local", title: "原曲", artists: [], duration: 1000 };
const candidate: LyricMatchCandidate = {
  id: "remote",
  origin: "qqmusic",
  platform: "qqmusic",
  format: "lrc",
  filename: "qq.lrc",
  content: "旧词",
  local: false,
  active: false,
  extra: { id: "123", mid: "mid123" },
};

beforeEach(() => {
  state.handlers.clear();
  state.local.mockReset();
  state.local.mockReturnValue([]);
  state.deleteCache.mockReset();
  state.deleteCache.mockReturnValue(["123"]);
  state.invalidateTtml.mockReset();
  state.invalidateTtml.mockResolvedValue(["mid123"]);
  registerLyricsIpc();
});

describe("单个歌词版本操作", () => {
  it("全量候选保留本地 AMLL 来源曲目和平台身份", async () => {
    const sourceTrack = {
      id: "source-track",
      title: "AMLL 来源曲目",
      artists: ["歌手"],
      duration: 1000,
    };
    const sourceExtra = { id: "987", mid: "amll-mid" };
    state.local.mockReturnValue([
      {
        versionId: "amll-version",
        origin: "amll",
        sourceTrack,
        sourceExtra,
        sourcePlatform: "qqmusic",
        content: "本地 AMLL 歌词",
        filename: "amll.ttml",
        format: "ttml",
      },
    ]);

    const candidates = await state.handlers.get("lyrics:getTrackCandidates")!(null, track);
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "amll-version",
          local: true,
          sourceTrack,
          extra: sourceExtra,
          platform: "qqmusic",
        }),
      ]),
    );
  });

  it("QQ 按所选 id 和 mid 重新抓取，不重新搜索也不请求其他平台", async () => {
    state.qq.mockResolvedValue({
      platform: "qqmusic",
      format: "qrc",
      content: "新词",
      extra: candidate.extra,
    });
    const result = await state.handlers.get("lyrics:refetchCandidate")!(null, track, candidate);
    expect(result).toMatchObject({ content: "新词", origin: "qqmusic", format: "qrc" });
    expect(state.deleteCache).toHaveBeenCalledExactlyOnceWith("qqmusic", "旧词", "123");
    expect(state.qq).toHaveBeenCalledExactlyOnceWith("123", "mid123", false);
    expect(state.netease).not.toHaveBeenCalled();
    expect(state.kugou).not.toHaveBeenCalled();
  });

  it("AMLL 使用当前命中的缓存 ID，缓存已经被清理时仍按原 ID 获取", async () => {
    state.invalidateTtml.mockResolvedValue([]);
    state.ttml.mockResolvedValue("新 TTML");
    const result = await state.handlers.get("lyrics:refetchCandidate")!(null, track, {
      ...candidate,
      origin: "amll",
      extra: { id: "matched-mid" },
    });
    expect(result).toMatchObject({ content: "新 TTML", extra: { id: "matched-mid" } });
    expect(state.invalidateTtml).toHaveBeenCalledExactlyOnceWith("qqmusic", "旧词", "matched-mid");
    expect(state.ttml).toHaveBeenCalledExactlyOnceWith("qqmusic", ["matched-mid"]);
  });

  it("本地版本重新读取原 UUID，不按来源去覆盖其他文件", async () => {
    state.local.mockReturnValue([
      {
        versionId: "uuid",
        origin: "manual",
        content: "文件新词",
        translation: "译文",
        romaji: "romaji",
        filename: "manual.lrc",
        format: "lrc",
      },
    ]);
    const result = await state.handlers.get("lyrics:refetchCandidate")!(null, track, {
      ...candidate,
      id: "uuid",
      local: true,
    });
    expect(result).toMatchObject({
      id: "uuid",
      content: "文件新词",
      translation: "译文",
      local: true,
    });
    expect(state.qq).not.toHaveBeenCalled();
    expect(state.deleteCache).not.toHaveBeenCalled();
  });

  it("删除在线版本只清理其缓存，不删除托管文件或清理全部平台", async () => {
    expect(await state.handlers.get("lyrics:deleteCandidate")!(null, track, candidate)).toBe(true);
    expect(state.deleteCache).toHaveBeenCalledExactlyOnceWith("qqmusic", "旧词", "123");
    expect(state.removeLocal).not.toHaveBeenCalled();
    expect(state.qq).not.toHaveBeenCalled();
  });

  it("只读本地 TTML 仓库不能经删除接口改写", async () => {
    expect(
      await state.handlers.get("lyrics:deleteCandidate")!(null, track, {
        ...candidate,
        origin: "localTtml",
      }),
    ).toBe(false);
    expect(state.deleteCache).not.toHaveBeenCalled();
  });

  it("刷新失败返回空值，面板可保留旧版本", async () => {
    state.qq.mockResolvedValue(null);
    expect(await state.handlers.get("lyrics:refetchCandidate")!(null, track, candidate)).toBeNull();
    expect(state.restoreCache).toHaveBeenCalledWith(
      "qqmusic",
      "123",
      expect.objectContaining({ content: "旧词" }),
    );
  });
});
