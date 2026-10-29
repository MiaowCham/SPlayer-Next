// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";

const state = vi.hoisted(() => ({ db: null as Database.Database | null, includeRemote: true }));
vi.mock("./index", () => ({ getDb: () => state.db, isDbOpen: () => true }));
vi.mock("./queries", () => ({
  getLibraryStats: () => ({
    trackCount: 1,
    albumCount: 1,
    artistCount: 1,
    totalDurationMs: 1000,
    totalFileSize: 20,
    codecs: [{ codec: "flac", count: 1 }],
  }),
}));
vi.mock("@main/store", () => ({ store: { get: () => state.includeRemote } }));
vi.mock("@main/utils/logger", () => ({ libraryLog: { error: vi.fn() } }));
import { getMediaStats } from "./mediaStats";
import {
  getTopTracks,
  getTopAlbums,
  getTopArtists,
  getPlayHistoryDaily,
  getPlayHistoryHourly,
  getStatsSummary,
} from "./playStats";

/**
 * 写入可重复播放的曲目快照
 * @param track - 曲目信息
 * @param at - 播放时间
 */
const record = (track: Track, at = Date.now()): void => {
  state
    .db!.prepare("INSERT INTO play_history VALUES (?, ?, ?, ?, ?)")
    .run(track.id, track.source, at, 6000, JSON.stringify(track));
};
const platform: Track = {
  id: "1",
  source: "netease",
  title: "在线歌曲",
  artists: [{ name: "歌手" }],
  album: { name: "专辑" },
  duration: 2000,
  quality: { codec: "flac", sampleRate: 96000, bitsPerSample: 24, channels: 2, bitRate: 900000 },
};

beforeEach(() => {
  state.includeRemote = true;
  state.db = new Database(":memory:");
  state.db.exec(`CREATE TABLE remote_tracks (data TEXT, updated_at INTEGER);
    CREATE TABLE play_history (track_id TEXT, source TEXT, started_at INTEGER, listened_ms INTEGER, track_json TEXT);
    CREATE TABLE favorite_history (source TEXT, action TEXT, at INTEGER);`);
});
afterEach(() => state.db?.close());

describe("跨来源统计", () => {
  it("平台重复播放只计一首，服务器原生 ID 相同仍按服务器区分", () => {
    record(platform, 1);
    record(platform, 2);
    for (const serverId of ["server-a", "server-b"]) {
      const track = { ...platform, source: "streaming", serverId, serverRevision: 1 };
      state.db!.prepare("INSERT INTO remote_tracks VALUES (?, ?)").run(JSON.stringify(track), 10);
      record(track as Track, 11);
    }
    expect(getMediaStats()).toMatchObject({
      trackCount: 4,
      albumCount: 4,
      artistCount: 4,
      totalDurationMs: 7000,
      totalFileSize: 20,
    });
    expect(getMediaStats().codecs).toContainEqual({ codec: "FLAC · Hi-Res", count: 3 });
    expect(getTopTracks(10)).toHaveLength(3);
    expect(getTopAlbums(10)).toHaveLength(3);
    expect(getTopArtists(10)).toHaveLength(3);
  });

  it("最新实际音质覆盖旧记录，关闭远端统计后恢复本地概览且不删除历史", () => {
    record(platform, 1);
    record({ ...platform, quality: { ...platform.quality!, codec: "mp3", bitRate: 320000 } }, 2);
    expect(getMediaStats().codecs).toContainEqual({ codec: "MP3 · HQ", count: 1 });
    state.includeRemote = false;
    expect(getMediaStats().trackCount).toBe(1);
    expect(state.db!.prepare("SELECT COUNT(*) AS n FROM play_history").get()).toEqual({ n: 2 });
  });

  it("播放排行、热图与汇总采用相同来源范围", () => {
    record({ ...platform, source: "local", id: "local-1" });
    record(platform);
    record({ ...platform, source: "streaming", id: "stream-1", serverId: "server-a" });
    expect(getTopTracks(10)).toHaveLength(3);
    expect(getTopAlbums(10)).toHaveLength(3);
    expect(getTopArtists(10)).toHaveLength(3);
    expect(getStatsSummary().totalPlayCount).toBe(3);
    state.includeRemote = false;
    expect(getTopTracks(10).map((item) => item.track.source)).toEqual(["local"]);
    expect(getTopAlbums(10)).toHaveLength(1);
    expect(getTopArtists(10)).toHaveLength(1);
    expect(getPlayHistoryDaily(1)[0].playCount).toBe(1);
    expect(getPlayHistoryHourly().reduce((sum, item) => sum + item.playCount, 0)).toBe(1);
    expect(getStatsSummary()).toMatchObject({ totalPlayCount: 1, totalListenedMs: 6000 });
  });
});
