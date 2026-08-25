// @vitest-environment node

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  db: null as Database.Database | null,
}));

vi.mock("./index", () => ({
  getDb: () => runtime.db,
}));

import { getTrackLyricPreference, setTrackLyricPreference } from "./lyricPreferences";

const track = { source: "netease" as const, id: "123" };

describe("单曲歌词来源首选项", () => {
  beforeEach(() => {
    runtime.db = new Database(":memory:");
    runtime.db.exec(`
      CREATE TABLE track_lyric_preferences (
        track_source TEXT NOT NULL,
        track_id TEXT NOT NULL,
        choice_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (track_source, track_id)
      );
    `);
  });

  afterEach(() => {
    runtime.db?.close();
    runtime.db = null;
  });

  it("按歌曲隔离持久化来源并允许显式选择智能模式", () => {
    setTrackLyricPreference(track, { source: "amll", platform: "qqmusic" });
    expect(getTrackLyricPreference(track)).toEqual({ source: "amll", platform: "qqmusic" });
    expect(getTrackLyricPreference({ ...track, id: "456" })).toBeNull();

    setTrackLyricPreference(track, { source: "auto" });
    expect(getTrackLyricPreference(track)).toEqual({ source: "auto" });
  });
});
