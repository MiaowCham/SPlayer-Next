import type { LyricData } from "../types/lyrics";
import type { Track } from "../types/player";

/**
 * 生成跨进程一致的歌词版本身份，正文更新后视为新版本
 * @param origin - 歌词提供方
 * @param platform - 在线平台
 * @param content - 歌词正文
 * @returns 提供方与正文摘要组成的标识
 */
export const lyricVersionId = (
  origin: string,
  platform: string | undefined,
  content: string,
): string => {
  let first = 2166136261;
  let second = 3339675911;
  for (let index = 0; index < content.length; index++) {
    const code = content.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 2246822519);
  }
  return `${origin}:${platform ?? ""}:${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
};

/**
 * 补齐播放器歌词的版本身份，托管版本保留文件 UUID
 * @param source - 歌词来源
 * @param content - 歌词正文
 * @returns 带版本身份的来源
 */
export const withLyricVersion = (
  source: NonNullable<LyricData>,
  content: string,
): NonNullable<LyricData> => ({
  ...source,
  versionId:
    source.versionId ??
    lyricVersionId(source.provider ?? source.platform ?? source.source, source.platform, content),
});

/**
 * 将偏移限定在正负一分钟内
 * @param value - 待保存的毫秒数
 * @returns 有限整数毫秒
 */
export const normalizeLyricOffset = (value: number): number =>
  Number.isFinite(value) ? Math.max(-60000, Math.min(60000, Math.trunc(value))) : 0;

/**
 * 构建曲目与歌词版本的独立偏移键，隔离流媒体服务器身份
 * @param track - 目标曲目
 * @param versionId - 歌词版本身份
 * @returns 持久化配置键
 */
export const lyricVersionOffsetKey = (track: Track, versionId: string): string =>
  JSON.stringify([
    "lyric-version",
    track.source,
    track.serverId ?? "",
    track.serverRevision ?? 0,
    track.id,
    versionId,
  ]);
