import type { TrackLyricPreference } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import { getDb } from "./index";

/** 读取单曲歌词来源首选项。 */
export const getTrackLyricPreference = (
  track: Pick<Track, "source" | "id">,
): TrackLyricPreference | null => {
  const row = getDb()
    .prepare(
      `SELECT choice_json FROM track_lyric_preferences
       WHERE track_source = ? AND track_id = ?`,
    )
    .get(track.source, track.id) as { choice_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.choice_json) as TrackLyricPreference;
  } catch {
    return null;
  }
};

/** 写入单曲歌词来源首选项。 */
export const setTrackLyricPreference = (
  track: Pick<Track, "source" | "id">,
  preference: TrackLyricPreference,
): void => {
  getDb()
    .prepare(
      `INSERT INTO track_lyric_preferences
        (track_source, track_id, choice_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(track_source, track_id) DO UPDATE SET
         choice_json = excluded.choice_json, updated_at = excluded.updated_at`,
    )
    .run(track.source, track.id, JSON.stringify(preference), Date.now());
};
