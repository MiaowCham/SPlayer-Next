/**
 * 歌词候选匹配 - 跨平台共享工具
 *
 * 三端（Netease / QQ / Kugou）搜索返回的候选结构不同，归一化成本结构后
 * 用 pickBestCandidate 挑出最匹配当前 track 的那一个，避免对多个候选串行请求歌词。
 */

import type { Track } from "@shared/types/player";

/** 归一化后的候选项 */
export interface LyricCandidate<Extra = unknown> {
  name: string;
  artist: string;
  album?: string;
  /** 毫秒 */
  duration?: number;
  extra: Extra;
}

/** 字符串归一化 */
export const normalize = (text: string | undefined | null): string => {
  if (!text) return "";
  return text.toLowerCase().replace(/[、&;，,/|()·・\s\-_'"`~!?？！.。]+/g, "");
};

/** 双向 includes 命中 */
const bothContains = (left: string, right: string): boolean =>
  left.length > 0 && right.length > 0 && (left.includes(right) || right.includes(left));

/** 拆分候选歌手文本 */
const splitArtists = (text: string | undefined | null): string[] =>
  (text ?? "")
    .split(/[、&;，,/|·・]+/g)
    .map(normalize)
    .filter(Boolean);

/** Track 全部歌手归一化 */
export const normalizeTrackArtists = (track: Track): string[] =>
  track.artists.map((artist) => normalize(artist.name)).filter(Boolean);

/** 搜索关键词用全部歌手，减少平台返回同名异歌手候选 */
export const buildLyricSearchKeyword = (track: Track): string =>
  [track.title, track.artists.map((artist) => artist.name).join(" ")]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");

/** 歌手是否有可用交集 */
const artistMatches = (
  candidateArtist: string | undefined | null,
  trackArtists: readonly string[],
): { exact: boolean; contains: boolean } => {
  if (trackArtists.length === 0) return { exact: false, contains: false };
  const candFull = normalize(candidateArtist);
  const candParts = splitArtists(candidateArtist);
  if (!candFull) return { exact: false, contains: false };
  const exact = trackArtists.some(
    (artist) => candFull === artist || candParts.some((part) => part === artist),
  );
  if (exact) return { exact: true, contains: false };
  const contains = trackArtists.some(
    (artist) =>
      artist.length >= 2 &&
      (bothContains(candFull, artist) || candParts.some((part) => bothContains(part, artist))),
  );
  return { exact: false, contains };
};

/** 时长是否在容差内（ms） */
const durationClose = (leftMs?: number, rightMs?: number, tolMs = 5000): boolean => {
  if (!leftMs || !rightMs) return false;
  return Math.abs(leftMs - rightMs) <= tolMs;
};

/**
 * 时长差是否大到能确认"不是同一首"
 * @param leftMs - 左时长（ms）
 * @param rightMs - 右时长（ms）
 * @param tolMs - 容差（ms）
 */
const durationFar = (leftMs?: number, rightMs?: number, tolMs = 20000): boolean => {
  if (!leftMs || !rightMs) return false;
  return Math.abs(leftMs - rightMs) > tolMs;
};

/** 子串命中时短串占长串的最低长度比，过低视为巧合 */
const NAME_CONTAIN_MIN_RATIO = 0.34;

/**
 * 从候选列表里挑出最匹配 track 的那一个
 *
 * 硬性条件（不满足直接跳过）
 *  - name 全等，或双向 includes 且短串占长串比例 ≥ NAME_CONTAIN_MIN_RATIO
 *  - 双方都给了 duration 时，差距不能超过 20s
 *  - track 有 artist 时，候选必须命中至少一个 artist，避免同名异歌手误匹配
 *
 * 打分规则（分数越高越优先）
 *  - name 全等：+10；name 子串命中：+4
 *  - artist 全等：+5；artist 双向 includes：+2
 *  - album 全等（且 track 有 album）：+2
 *  - duration 接近（±5s）：+3
 */
export const pickBestCandidate = <E>(
  candidates: LyricCandidate<E>[],
  track: Track,
): LyricCandidate<E> | null => {
  const trackName = normalize(track.title);
  const trackArtists = normalizeTrackArtists(track);
  const trackAlbum = normalize(track.album?.name);
  const trackDuration = track.duration;

  let best: LyricCandidate<E> | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const candName = normalize(candidate.name);
    const candAlbum = normalize(candidate.album);

    const nameExact = candName.length > 0 && candName === trackName;
    if (!nameExact) {
      if (!bothContains(candName, trackName)) continue;
      const longer = Math.max(candName.length, trackName.length);
      const shorter = Math.min(candName.length, trackName.length);
      if (shorter / longer < NAME_CONTAIN_MIN_RATIO) continue;
    }

    if (durationFar(candidate.duration, trackDuration)) continue;

    const artist = artistMatches(candidate.artist, trackArtists);
    if (trackArtists.length > 0 && !artist.exact && !artist.contains) continue;
    // 置信度地板：name 仅子串命中时必须有 artist 或时长佐证，否则视为巧合 substring 丢弃
    if (
      !nameExact &&
      !artist.exact &&
      !artist.contains &&
      !durationClose(candidate.duration, trackDuration)
    ) {
      continue;
    }

    let score = nameExact ? 10 : 4;
    if (artist.exact) score += 5;
    else if (artist.contains) score += 2;
    if (trackAlbum && candAlbum === trackAlbum) score += 2;
    if (durationClose(candidate.duration, trackDuration)) score += 3;

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
};

/**
 * 毫秒 → LRC 时间戳 `[mm:ss.mmm]`
 * @param ms 毫秒时间
 */
export const formatLrcTimestamp = (ms: number): string => {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(Math.round(ms));
  const minutes = Math.floor(abs / 60_000);
  const seconds = Math.floor((abs % 60_000) / 1000);
  const millis = abs % 1000;
  return `${sign}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
};

/**
 * 归一化网易云 lrc 内容。
 *
 * `/api/song/lyric/v1` 现在把作词/作曲等元数据行返回成 JSON 逐字格式：
 *   {"t":0,"c":[{"tx":"作词: "},{"tx":"张卡斯","li":"...","or":"..."}]}
 * 部分歌曲正文也会整首用这种 JSON 逐字表示（每行一个 `t` + 词数组），
 * 若不转换，`parseLRC` 会因找不到 `[mm:ss]` 行而得到空行（NO-LRC）。
 * 这里把 JSON 逐字行转成标准 LRC 行，负时间戳（元数据）直接丢弃。
 * @param lrc 原始 lrc.lyric 文本
 */
export const normalizeNeteaseLrc = (lrc: string): string => {
  if (!lrc.includes('{"t":')) return lrc;
  const out: string[] = [];
  for (const raw of lrc.split("\n")) {
    const line = raw.trim();
    if (!line) {
      out.push(raw);
      continue;
    }
    if (line.startsWith("{")) {
      try {
        const obj = JSON.parse(line) as {
          t?: number;
          c?: { tx?: string }[];
        };
        const t = Number(obj.t);
        const text = (obj.c ?? [])
          .map((word) => String(word?.tx ?? ""))
          .join("")
          .trim();
        if (!text || !Number.isFinite(t) || t < 0) continue;
        out.push(`[${formatLrcTimestamp(t)}]${text}`);
        continue;
      } catch {
        // 非 JSON 的 `{` 行原样保留
      }
    }
    out.push(raw);
  }
  return out.join("\n");
};
