import type { Track } from "@shared/types/player";

/** Apple Music 搜索候选。 */
export interface AppleMusicSong {
  id: string;
  title: string;
  artist: string;
  duration: number;
  isrc: string;
  storefront: string;
}

/** 标准化曲名与歌手，供跨平台候选匹配使用。 */
export const normalizeAppleMusicText = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]/gu, "");

/** 根据曲名、歌手与时长为 Apple Music 候选打分。 */
export const scoreAppleMusicSong = (track: Track, song: AppleMusicSong): number => {
  const title = normalizeAppleMusicText(track.title);
  const candidateTitle = normalizeAppleMusicText(song.title);
  const artists = normalizeAppleMusicText(track.artists.map((artist) => artist.name).join(" "));
  const candidateArtist = normalizeAppleMusicText(song.artist);
  let score =
    title === candidateTitle
      ? 10
      : title.includes(candidateTitle) || candidateTitle.includes(title)
        ? 5
        : 0;
  if (artists && (artists.includes(candidateArtist) || candidateArtist.includes(artists))) {
    score += 3;
  }
  if (track.duration > 0 && Math.abs(track.duration - song.duration) <= 2_000) score += 3;
  return score;
};

/** 从候选列表中选出可信度最高的一首。 */
export const pickAppleMusicSong = (
  track: Track,
  songs: AppleMusicSong[],
): AppleMusicSong | null => {
  let best: AppleMusicSong | null = null;
  let bestScore = 0;
  for (const song of songs) {
    const score = scoreAppleMusicSong(track, song);
    if (score > bestScore) {
      best = song;
      bestScore = score;
    }
  }
  return bestScore >= 8 ? best : null;
};

/** 生成 Apple Music 歌词请求的本地化参数。 */
export const buildAppleMusicLyricQuery = (language: string, script: string): string => {
  const params = new URLSearchParams({ extend: "ttmlLocalizations" });
  if (language) params.set("l[lyrics]", language);
  const resolvedScript = script || language.split("-").slice(0, 2).join("-");
  if (resolvedScript) params.set("l[script]", resolvedScript);
  return params.toString();
};
