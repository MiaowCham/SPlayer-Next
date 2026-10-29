import { getDb } from "./index";
import { getLibraryStats } from "./queries";
import { store } from "@main/store";
import { getQualityLabel } from "@shared/utils/audioQuality";
import type { AudioQuality } from "@shared/types/player";
import type { LibraryStats } from "@shared/types/stats";

/**
 * 返回统计查询的来源范围，历史记录仍完整保留
 * @param alias - 查询内部使用的表别名
 * @returns 来源筛选 SQL
 */
export const statsSourceFilter = (alias = ""): string =>
  store.get("mediaSource.includeRemoteStats") ? "1" : `${alias ? alias + "." : ""}source = 'local'`;

const REMOTE_TRACKS = `WITH candidates AS (
  SELECT data, 0 AS priority, updated_at AS at FROM remote_tracks
  UNION ALL
  SELECT track_json AS data, 1 AS priority, started_at AS at FROM play_history
  WHERE source IN ('netease', 'qqmusic', 'kugou', 'streaming')
), ranked AS (
  SELECT data, ROW_NUMBER() OVER (
    PARTITION BY json_extract(data, '$.source'),
                 COALESCE(json_extract(data, '$.serverId'), ''),
                 COALESCE(json_extract(data, '$.serverRevision'), 0),
                 json_extract(data, '$.id')
    ORDER BY priority DESC, at DESC
  ) AS rank FROM candidates
), media AS (
  SELECT data FROM ranked WHERE rank = 1
)`;

/**
 * 聚合本地曲库、已同步流媒体与已播放的平台曲目，远端数据仅在 SQLite 内展开
 * @returns 去重后的曲目概览及格式、实际音质分布
 */
export const getMediaStats = (): LibraryStats => {
  const local = getLibraryStats();
  if (!store.get("mediaSource.includeRemoteStats")) return local;
  const db = getDb();
  const counts = db
    .prepare(
      REMOTE_TRACKS +
        `
    SELECT COUNT(*) AS trackCount,
           COALESCE(SUM(json_extract(data, '$.duration')), 0) AS totalDurationMs,
           COALESCE(SUM(json_extract(data, '$.fileSize')), 0) AS totalFileSize,
           COUNT(DISTINCT CASE WHEN TRIM(COALESCE(json_extract(data, '$.album.name'), '')) != ''
             THEN json_array(json_extract(data, '$.source'), json_extract(data, '$.serverId'),
                  json_extract(data, '$.serverRevision'), COALESCE(json_extract(data, '$.album.id'),
                  json_extract(data, '$.album.name'))) END) AS albumCount
    FROM media
  `,
    )
    .get() as Omit<LibraryStats, "artistCount" | "codecs">;
  const artists = db
    .prepare(
      REMOTE_TRACKS +
        `
    SELECT COUNT(DISTINCT json_array(json_extract(data, '$.source'),
      json_extract(data, '$.serverId'), json_extract(data, '$.serverRevision'),
      COALESCE(json_extract(artist.value, '$.id'), LOWER(json_extract(artist.value, '$.name'))))) AS count
    FROM media, json_each(data, '$.artists') artist
    WHERE TRIM(COALESCE(json_extract(artist.value, '$.name'), '')) != ''
  `,
    )
    .get() as { count: number };
  const qualityRows = db
    .prepare(
      REMOTE_TRACKS +
        `
    SELECT COALESCE(LOWER(json_extract(data, '$.quality.codec')), '') AS codec,
           COALESCE(json_extract(data, '$.quality.sampleRate'), 0) AS sampleRate,
           COALESCE(json_extract(data, '$.quality.bitsPerSample'), 0) AS bitsPerSample,
           COALESCE(json_extract(data, '$.quality.bitRate'), 0) AS bitRate,
           COUNT(*) AS count FROM media
    GROUP BY codec, sampleRate, bitsPerSample, bitRate
  `,
    )
    .all() as (AudioQuality & { count: number })[];
  const formats = new Map(local.codecs.map((item) => [item.codec.toUpperCase(), item.count]));
  for (const row of qualityRows) {
    const label =
      row.codec && row.codec !== "unknown"
        ? row.codec.toUpperCase() + " · " + getQualityLabel(row)
        : "";
    formats.set(label, (formats.get(label) ?? 0) + row.count);
  }
  return {
    trackCount: local.trackCount + counts.trackCount,
    albumCount: local.albumCount + counts.albumCount,
    artistCount: local.artistCount + artists.count,
    totalDurationMs: local.totalDurationMs + counts.totalDurationMs,
    totalFileSize: local.totalFileSize + counts.totalFileSize,
    codecs: [...formats]
      .map(([codec, count]) => ({ codec, count }))
      .sort((a, b) => b.count - a.count || a.codec.localeCompare(b.codec)),
  };
};
