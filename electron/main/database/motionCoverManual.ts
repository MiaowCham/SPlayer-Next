/**
 * 手动指定的动态封面
 *
 * 表：motion_cover_manual(track_key, source, payload, updated_at)
 * 手动记录优先于自动匹配，按曲目身份保存
 */

import type { MotionCoverManualRecord, Track } from "@shared/types/player";
import { getDb } from "./index";

/**
 * 生成手动记录的曲目键
 * @param track - 曲目
 * @returns 包含服务器身份的稳定键
 */
export const manualTrackKey = (track: Track): string =>
  `${track.source}:${track.serverId ?? ""}:${track.id}`;

/**
 * 读取曲目手动指定的动态封面
 * @param track - 曲目
 * @returns 手动记录，未指定时为 null
 */
export const getManualMotionCover = (track: Track): MotionCoverManualRecord | null => {
  const row = getDb()
    .prepare("SELECT source, payload FROM motion_cover_manual WHERE track_key = ?")
    .get(manualTrackKey(track)) as { source: string; payload: string } | undefined;
  if (!row) return null;
  try {
    const payload = JSON.parse(row.payload) as Omit<MotionCoverManualRecord, "source">;
    return { ...payload, source: row.source as MotionCoverManualRecord["source"] };
  } catch {
    return null;
  }
};

/**
 * 保存手动指定的动态封面
 * @param track - 曲目
 * @param record - 手动记录
 */
export const setManualMotionCover = (track: Track, record: MotionCoverManualRecord): void => {
  const { source, ...payload } = record;
  getDb()
    .prepare(
      `INSERT INTO motion_cover_manual (track_key, source, payload, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(track_key) DO UPDATE SET
         source = excluded.source,
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
    )
    .run(manualTrackKey(track), source, JSON.stringify(payload), record.updatedAt);
};

/**
 * 清除手动指定的动态封面
 * @param track - 曲目
 */
export const clearManualMotionCover = (track: Track): void => {
  getDb().prepare("DELETE FROM motion_cover_manual WHERE track_key = ?").run(manualTrackKey(track));
};
