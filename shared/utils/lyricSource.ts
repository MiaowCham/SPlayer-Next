import type { LyricMatchCandidate, LyricSearchSong, LyricSearchSource } from "../types/lyrics";
import type { Track } from "../types/player";

/**
 * 将来源名称与绑定平台组合为独立来源身份
 * @param source - 歌词来源
 * @returns 来源键
 */
export const lyricSourceKey = (source: LyricSearchSource): string =>
  `${source.origin}:${source.platform ?? ""}`;

/**
 * 归一化歌曲比较文本，保留语言文字和数字
 * @param value - 标题或艺术家
 * @returns 比较用文本
 */
const normalize = (value: string): string =>
  value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");

/**
 * 依据实际来源元数据评估匹配度，缺失元数据时不推断完美匹配
 * @param track - 目标歌曲
 * @param song - 来源曲目元数据
 * @returns 可用于标签的匹配等级
 */
export const lyricMatchQuality = (
  track: Track,
  song?: LyricSearchSong,
): "perfect" | "high" | "medium" | "low" | "unknown" => {
  if (!song?.title) return "unknown";
  const title = normalize(track.title);
  const other = normalize(song.title);
  if (!title || !other) return "unknown";
  const exact = title === other;
  const artist = track.artists.some((target) =>
    song.artists.some((name) => normalize(name) === normalize(target.name)),
  );
  const duration =
    track.duration > 0 && song.duration > 0 ? Math.abs(track.duration - song.duration) : null;
  if (exact && artist && duration !== null && duration <= 2000) return "perfect";
  if (exact && artist && (duration === null || duration <= 5000)) return "high";
  if (
    (exact || title.includes(other) || other.includes(title)) &&
    (artist || (duration !== null && duration <= 5000))
  )
    return "medium";
  return "low";
};

/**
 * 读取歌词文件声明的来源 offset，与用户版本偏移分别展示
 * @param candidate - 歌词版本
 * @returns 文件声明的毫秒偏移，没有声明时为零
 */
export const lyricSourceOffset = (candidate: Pick<LyricMatchCandidate, "content">): number => {
  const value = Number(candidate.content.match(/\[offset:\s*([+-]?\d+)\s*\]/i)?.[1] ?? 0);
  return Number.isFinite(value) ? value : 0;
};

/**
 * 解析指定来源的歌曲 ID 或官方链接，不跟随短链或访问用户输入的地址
 * @param source - 当前来源及平台
 * @param input - ID 或官方详情页链接
 * @returns 来源曲目身份，格式不符时为空
 */
export const parseLyricSourceId = (source: LyricSearchSource, input: string): string | null => {
  const platform = source.origin === "amll" ? source.platform : source.origin;
  let value = input.trim();
  if (/^https?:/i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (platform === "netease" && /(^|\.)music\.163\.com$/i.test(url.hostname)) {
      value =
        new URLSearchParams((url.hash.split("?")[1] ?? url.search).replace(/^\?/, "")).get("id") ??
        url.pathname.match(/\/song\/(\d+)/)?.[1] ??
        "";
    } else if (platform === "qqmusic" && /(^|\.)y\.qq\.com$/i.test(url.hostname)) {
      value =
        url.searchParams.get("songmid") ??
        url.searchParams.get("songid") ??
        url.pathname.match(/\/(?:songDetail|song)\/([A-Za-z0-9]+)/i)?.[1] ??
        "";
    } else if (platform === "kugou" && /(^|\.)kugou\.com$/i.test(url.hostname)) {
      value =
        url.searchParams.get("hash") ??
        url.pathname.match(/\/mixsong\/([A-Fa-f0-9]{32})/i)?.[1] ??
        "";
    } else if (platform === "appleMusic" && url.hostname === "music.apple.com") {
      value = url.searchParams.get("i") ?? url.pathname.match(/(?:\/id?|\/)(\d+)\/?$/)?.[1] ?? "";
    } else return null;
  }
  if (platform === "netease" || platform === "appleMusic")
    return /^\d+$/.test(value) ? value : null;
  if (platform === "qqmusic") return /^(?:\d+|[A-Za-z0-9]{14})$/.test(value) ? value : null;
  if (platform === "localTtml") return /^[A-Fa-f0-9]{64}$/.test(value) ? value.toLowerCase() : null;
  if (platform === "kugou") return /^[A-Fa-f0-9]{32}$/.test(value) ? value.toUpperCase() : null;
  return null;
};
