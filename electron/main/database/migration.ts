import type Database from "better-sqlite3";

/** 当前 schema 版本 */
const SCHEMA_VERSION = 8;

type TableInfoRow = { name: string };

/** 判断表是否存在指定列 */
const hasColumn = (d: Database.Database, table: string, column: string): boolean => {
  const rows = d.prepare(`PRAGMA table_info(${table})`).all() as TableInfoRow[];
  return rows.some((r) => r.name === column);
};

/** 执行数据库迁移 */
export const migrate = (d: Database.Database): void => {
  const version = d.pragma("user_version", { simple: true }) as number;
  let v = version;

  // v1 → v2: 添加 file_mtime / file_ctime 列
  if (v < 2) {
    if (!hasColumn(d, "tracks", "file_mtime")) {
      d.exec("ALTER TABLE tracks ADD COLUMN file_mtime INTEGER");
    }
    if (!hasColumn(d, "tracks", "file_ctime")) {
      d.exec("ALTER TABLE tracks ADD COLUMN file_ctime INTEGER");
    }
    v = 2;
  }

  // v2 → v3: 添加 track 列
  if (v < 3) {
    if (!hasColumn(d, "tracks", "track")) {
      d.exec("ALTER TABLE tracks ADD COLUMN track INTEGER");
    }
    v = 3;
  }

  // v3 → v4: 添加 CUE 分轨列
  if (v < 4) {
    if (!hasColumn(d, "tracks", "cue_path")) {
      d.exec("ALTER TABLE tracks ADD COLUMN cue_path TEXT");
    }
    if (!hasColumn(d, "tracks", "cue_audio_path")) {
      d.exec("ALTER TABLE tracks ADD COLUMN cue_audio_path TEXT");
    }
    if (!hasColumn(d, "tracks", "cue_start_ms")) {
      d.exec("ALTER TABLE tracks ADD COLUMN cue_start_ms INTEGER");
    }
    if (!hasColumn(d, "tracks", "cue_end_ms")) {
      d.exec("ALTER TABLE tracks ADD COLUMN cue_end_ms INTEGER");
    }
    v = 4;
  }

  if (v < 5) v = 5;

  if (v < 6) {
    if (!hasColumn(d, "managed_lyrics", "track_json")) {
      d.exec("ALTER TABLE managed_lyrics ADD COLUMN track_json TEXT");
    }
    v = 6;
  }

  if (v < 7) {
    if (!hasColumn(d, "managed_lyrics", "active_version_id")) {
      d.exec("ALTER TABLE managed_lyrics ADD COLUMN active_version_id TEXT");
    }
    d.exec(`
      CREATE TABLE IF NOT EXISTS managed_lyric_versions (
        version_id TEXT PRIMARY KEY,
        track_source TEXT NOT NULL,
        track_id TEXT NOT NULL,
        data TEXT NOT NULL,
        filename TEXT NOT NULL COLLATE NOCASE,
        origin TEXT NOT NULL,
        imported_at INTEGER NOT NULL,
        UNIQUE(track_source, track_id, filename)
      );
      CREATE INDEX IF NOT EXISTS idx_managed_lyric_versions_track
        ON managed_lyric_versions(track_source, track_id, imported_at DESC);
    `);
    v = 7;
  }

  if (v < 8) {
    d.exec(`
      CREATE TABLE IF NOT EXISTS track_lyric_preferences (
        track_source TEXT NOT NULL,
        track_id TEXT NOT NULL,
        choice_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (track_source, track_id)
      );
    `);
    v = 8;
  }

  // 版本无关部分
  // 补 lyric_match_cache.extra 列
  if (!hasColumn(d, "lyric_match_cache", "extra")) {
    d.exec("ALTER TABLE lyric_match_cache ADD COLUMN extra TEXT");
  }

  if (v < SCHEMA_VERSION) v = SCHEMA_VERSION;
  if (v !== version) {
    d.pragma(`user_version = ${v}`);
  }
};
