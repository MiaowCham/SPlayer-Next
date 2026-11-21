/**
 * 动态封面匹配缓存
 *
 * 表：motion_cover_cache(fingerprint, video_url, track_json, matched_at)
 * fingerprint 为曲目指纹或 album / collection 前缀的专辑键，同专辑曲目借此跳过重复请求
 * video_url 为空表示未匹配到或专辑无动态封面，按较短 TTL 过期后重试
 */

import type { MotionCoverCacheRecord, Track } from "@shared/types/player";
import { getDb } from "./index";

/** 命中结果的有效期：Apple 会随时替换节日/活动动效封面，一天后重新校验 */
const HIT_TTL_MS = 24 * 60 * 60 * 1000;
/** 未命中的有效期：限流/网络波动造成的失败不该锁太久 */
const MISS_TTL_MS = 10 * 60 * 1000;

/**
 * 读取未过期的匹配结果
 * @param fingerprint - 曲目指纹
 * @returns 视频主播放列表地址；null 表示已确认无动态封面；undefined 表示需要重新匹配
 */
export const getMotionCoverRecord = (fingerprint: string): string | null | undefined => {
  const row = getDb()
    .prepare("SELECT video_url, matched_at FROM motion_cover_cache WHERE fingerprint = ?")
    .get(fingerprint) as { video_url: string | null; matched_at: number } | undefined;
  if (!row) return undefined;
  const ttl = row.video_url ? HIT_TTL_MS : MISS_TTL_MS;
  if (Date.now() - row.matched_at > ttl) return undefined;
  return row.video_url;
};

/**
 * 写入匹配结果
 * @param fingerprint - 曲目指纹
 * @param videoUrl - 视频主播放列表地址，无动态封面时为 null
 * @param track - 产生该记录的曲目，供管理界面展示
 */
export const setMotionCoverRecord = (
  fingerprint: string,
  videoUrl: string | null,
  track?: Track,
): void => {
  getDb()
    .prepare(
      `INSERT INTO motion_cover_cache (fingerprint, video_url, track_json, matched_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(fingerprint) DO UPDATE SET
         video_url = excluded.video_url,
         track_json = COALESCE(excluded.track_json, motion_cover_cache.track_json),
         matched_at = excluded.matched_at`,
    )
    .run(fingerprint, videoUrl, track ? JSON.stringify(track) : null, Date.now());
};

/**
 * 读取全部动态封面匹配记录，供设置页管理
 * @returns 按匹配时间倒序的记录，最多 500 条
 */
export const listMotionCoverRecords = (): MotionCoverCacheRecord[] => {
  const rows = getDb()
    .prepare(
      `SELECT fingerprint, video_url, track_json, matched_at
       FROM motion_cover_cache
       WHERE fingerprint NOT LIKE 'search|%'
       ORDER BY matched_at DESC
       LIMIT 500`,
    )
    .all() as {
    fingerprint: string;
    video_url: string | null;
    track_json: string | null;
    matched_at: number;
  }[];

  return rows.map((row) => {
    let track: Track | undefined;
    if (row.track_json) {
      try {
        track = JSON.parse(row.track_json) as Track;
      } catch {
        track = undefined;
      }
    }
    return {
      fingerprint: row.fingerprint,
      videoUrl: row.video_url,
      matchedAt: row.matched_at,
      track,
    };
  });
};

/**
 * 删除单条匹配记录，下次播放会重新匹配
 * @param fingerprint - 曲目指纹
 */
export const deleteMotionCoverRecord = (fingerprint: string): void => {
  getDb().prepare("DELETE FROM motion_cover_cache WHERE fingerprint = ?").run(fingerprint);
};

/** 清空匹配缓存 */
export const clearMotionCoverCache = (): void => {
  getDb().prepare("DELETE FROM motion_cover_cache").run();
};
