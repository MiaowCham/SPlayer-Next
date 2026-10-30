/**
 * QQMusic 歌词匹配
 *
 * 两个入口：
 *  - getByPlatformId(id)    按 QQMusic song id 直取
 *  - getByQuery(track)      search → pickBestCandidate → 单次请求拿歌词
 *
 * 返回只带原生格式文本（qrc / lrc + 翻译 / 罗马音），不做解析，交给渲染端。
 */

import { detectFormat } from "lyric-kit";
import { callQQMusic } from "@main/apis/qqmusic";
import { getCachedLyric, setCachedLyric } from "@main/database/lyricCache";
import { buildFingerprint, getMatchedId, setMatchedId } from "@main/database/lyricMatchCache";
import { coreLog } from "@main/utils/logger";
import type { LyricMatchResult } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import { prefetchTTML } from "./ttml";
import { buildLyricSearchKeyword, pickBestCandidate, type LyricCandidate } from "./utils";

/** qrc 优先，其次 lrc */
const pickFormatted = (
  qrc?: string,
  lrc?: string,
): { content: string; format: "qrc" | "lrc" } | undefined => {
  const qrcContent = qrc?.trim();
  if (qrcContent) return { content: qrcContent, format: "qrc" };
  const lrcContent = lrc?.trim();
  if (lrcContent) return { content: lrcContent, format: "lrc" };
  return undefined;
};

/**
 * 按 QQMusic 数字 songID 直取歌词
 * @param id - 数字 songID
 * @param mid - 字符串 mid（用于 AMLL TTML DB 等外部映射）
 * @param prefetch - 是否预热 AMLL，单独操作 QQ 来源时关闭
 * @returns 歌词及各自的实际格式，未命中时返回 null
 */
export const getByPlatformId = async (
  id: string,
  mid?: string,
  prefetch = true,
): Promise<LyricMatchResult | null> => {
  // 立刻预热 TTML 抓取，与本接口的 lyric 调用并行
  // AMLL DB 里 QM 条目 mid / 数字 id 都可能是 key，依次试
  if (prefetch) prefetchTTML("qqmusic", mid ? [mid, id] : [id]);

  const cached = getCachedLyric("qqmusic", id);
  if (cached) {
    if (cached.romaji) cached.romajiFormat = detectFormat(cached.romaji);
    return cached;
  }
  try {
    const body = await callQQMusic("lyric", { id });
    if (body.code !== 200) {
      coreLog.warn(
        `[lyric:qqmusic] getByPlatformId(${id}) code=${body.code}: ${body.message ?? "no message"}`,
      );
      return null;
    }

    const main = pickFormatted(body.qrc, body.lrc);
    if (!main) {
      coreLog.info(
        `[lyric:qqmusic] getByPlatformId(${id}) 无主歌词: qrc=${!!body.qrc}, lrc=${!!body.lrc}`,
      );
      return null;
    }

    const trans = body.trans?.trim();
    const roma = body.roma?.trim();

    const result: LyricMatchResult = {
      platform: "qqmusic",
      format: main.format,
      content: main.content,
      translation: trans || undefined,
      translationFormat: trans ? "lrc" : undefined,
      romaji: roma || undefined,
      romajiFormat: roma ? detectFormat(roma) : undefined,
      extra: mid ? { mid, id } : id ? { id } : undefined,
    };
    setCachedLyric("qqmusic", id, result);
    coreLog.info(
      `[lyric:qqmusic] getByPlatformId(${id}) 命中: format=${result.format}, chars=${result.content.length}`,
    );
    return result;
  } catch (err) {
    coreLog.warn(`[lyric:qqmusic] getByPlatformId(${id}) failed:`, err);
    return null;
  }
};

/**
 * 模糊搜索平台曲目并只下载最佳候选的歌词
 * @param track - 目标曲目
 * @param prefetch - 是否允许预热 AMLL，单来源操作时关闭
 * @returns 带匹配元数据的歌词
 */
export const getByQuery = async (
  track: Track,
  prefetch = true,
): Promise<LyricMatchResult | null> => {
  const fingerprint = buildFingerprint(track);
  const cached = getMatchedId(fingerprint, "qqmusic");
  if (cached) return getByPlatformId(cached.platformId, cached.extra?.mid, prefetch);

  const keyword = buildLyricSearchKeyword(track);
  if (!keyword) return null;

  const candidates: LyricCandidate<{ id: string; mid: string }>[] = [];
  try {
    const body = await callQQMusic("search", { keywords: keyword, limit: 25 });
    if (body.code !== 200) return null;
    for (const song of body.songs ?? []) {
      candidates.push({
        name: song.name,
        artist: song.artist,
        album: song.album,
        duration: song.duration,
        extra: { id: song.id, mid: song.mid },
      });
    }
  } catch (err) {
    coreLog.warn(`[lyric:qqmusic] search("${keyword}") failed:`, err);
    return null;
  }

  const best = pickBestCandidate(candidates, track);
  coreLog.info(
    `[lyric:qqmusic] fuzzy "${keyword}" → ${candidates.length} hits, best=${best?.name ?? "none"}`,
  );
  if (!best) return null;
  setMatchedId(fingerprint, "qqmusic", best.extra.id, { mid: best.extra.mid });
  const result = await getByPlatformId(best.extra.id, best.extra.mid, prefetch);
  if (!result) return null;
  const enriched = {
    ...result,
    sourceTrack: {
      id: best.extra.id,
      title: best.name,
      artists: [best.artist],
      album: best.album,
      duration: best.duration ?? 0,
    },
  };
  setCachedLyric("qqmusic", best.extra.id, enriched);
  return enriched;
};
