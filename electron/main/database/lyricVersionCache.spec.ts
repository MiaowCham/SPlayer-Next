// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ db: null as Database.Database | null }));
vi.mock("./index", () => ({ getDb: () => state.db }));
import { deleteLyricVersionCache } from "./lyricCache";
import { deleteTtmlVersionCache } from "./lyricTtmlCache";

beforeEach(() => {
  state.db = new Database(":memory:");
  state.db.exec(
    "CREATE TABLE lyric_cache (platform TEXT, platform_id TEXT, data TEXT); CREATE TABLE lyric_ttml_cache (platform TEXT, id TEXT, content TEXT)",
  );
});
afterEach(() => state.db?.close());
describe("精确清理歌词版本缓存", () => {
  it("平台与曲目 ID 均相符才删除旧正文，不删除同平台其他曲目", () => {
    for (const [platform, id, content] of [
      ["netease", "1", "旧词"],
      ["netease", "2", "旧词"],
      ["qqmusic", "1", "旧词"],
      ["netease", "3", "新词"],
    ]) {
      state
        .db!.prepare("INSERT INTO lyric_cache VALUES (?, ?, ?)")
        .run(platform, id, JSON.stringify({ content }));
    }
    expect(deleteLyricVersionCache("netease", "旧词", "1")).toEqual(["1"]);
    expect(deleteLyricVersionCache("netease", "旧词", "3")).toEqual([]);
    expect(state.db!.prepare("SELECT COUNT(*) AS n FROM lyric_cache").get()).toEqual({ n: 3 });
  });
  it("TTML 正文清理返回实际命中 ID，保留其他来源、其他正文和负缓存", () => {
    for (const [platform, id, content] of [
      ["netease", "1", "旧词"],
      ["netease", "2", null],
      ["qqmusic", "1", "旧词"],
      ["netease", "3", "新词"],
    ]) {
      state.db!.prepare("INSERT INTO lyric_ttml_cache VALUES (?, ?, ?)").run(platform, id, content);
    }
    expect(deleteTtmlVersionCache("netease", "旧词")).toEqual(["1"]);
    expect(state.db!.prepare("SELECT COUNT(*) AS n FROM lyric_ttml_cache").get()).toEqual({ n: 3 });
  });
});
