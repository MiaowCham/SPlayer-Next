/**
 * Apple Music TTML 歌词来源。
 *
 * 实现参考 am-ttml-fetch（1412，AGPL-3.0-or-later），并改为主进程内置服务。
 */
import type { Track } from "@shared/types/player";
import type { AppleMusicTTMLFetchResult } from "@shared/types/lyrics";
import { store } from "@main/store";
import { coreLog } from "@main/utils/logger";
import { getCachedTTML, setCachedTTML } from "@main/database/lyricTtmlCache";
import { getAppleMusicMediaUserToken } from "./appleMusicLyricsToken";
import {
  buildAppleMusicLyricQuery,
  pickAppleMusicSong,
  type AppleMusicMatchLevel,
  type AppleMusicSong,
} from "./appleMusicLyricsUtils";

const APPLE_MUSIC_ORIGIN = "https://music.apple.com";
const APPLE_MUSIC_API = "https://amp-api.music.apple.com/v1";
const TIMEOUT_MS = 20_000;
const LYRIC_CACHE_LIMIT = 50;
const BUNDLE_PATTERN = /["'](\/assets\/index~[A-Za-z0-9]+\.js)["']/u;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/gu;

interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}

let developerToken: TokenCacheEntry | null = null;
let developerTokenTask: Promise<string> | null = null;
const lyricCache = new Map<string, string>();
const inflight = new Map<string, Promise<AppleMusicTTMLFetchResult>>();

/** 仅用于诊断令牌是否真正参与了请求，绝不记录令牌全文。 */
const describeMediaUserToken = (token: string): string =>
  token.length <= 10
    ? `${token.slice(0, 2)}…(${token.length})`
    : `${token.slice(0, 6)}…${token.slice(-4)}(${token.length})`;

const fetchResult = (
  status: AppleMusicTTMLFetchResult["status"],
  lyric: string | null = null,
  message?: string,
): AppleMusicTTMLFetchResult => ({ status, lyric, message });

/** 使用歌曲与请求参数生成持久化缓存键，避免 Apple 搜索每次重新发起。 */
const buildCacheKey = (track: Track, language: string, script: string): string =>
  JSON.stringify([
    track.source,
    track.serverId ?? "",
    track.originalId ?? "",
    track.id,
    track.title,
    track.artists.map((artist) => artist.name),
    language,
    script,
  ]);

/** 解析 JWT 的过期时间。 */
const readJwtExpiry = (token: string): number | null => {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(base64, "base64").toString("utf8");
    const expiresAt = JSON.parse(json).exp;
    return typeof expiresAt === "number" ? expiresAt : null;
  } catch {
    return null;
  }
};

/** 从 Apple Music Web 播放器入口脚本提取尚未过期的开发者令牌。 */
const fetchDeveloperToken = async (): Promise<TokenCacheEntry> => {
  const home = await fetch(`${APPLE_MUSIC_ORIGIN}/`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const html = await home.text();
  const bundlePath = html.match(BUNDLE_PATTERN)?.[1];
  if (!bundlePath) throw new Error("未能定位 Apple Music Web 播放器脚本");
  const bundle = await fetch(`${APPLE_MUSIC_ORIGIN}${bundlePath}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const source = await bundle.text();
  const now = Math.floor(Date.now() / 1000);
  const candidates = [...new Set(source.match(JWT_PATTERN) ?? [])]
    .map((token) => ({ token, expiresAt: readJwtExpiry(token) }))
    .filter((entry): entry is TokenCacheEntry => !!entry.expiresAt && entry.expiresAt > now + 300)
    .sort((left, right) => right.expiresAt - left.expiresAt);
  const selected = candidates[0];
  if (!selected) throw new Error("未能取得有效的 Apple Music 开发者令牌");
  return selected;
};

/** 获取可用的 Apple Music 开发者令牌，并合并并发刷新。 */
const getDeveloperToken = async (force = false): Promise<string> => {
  const now = Math.floor(Date.now() / 1000);
  if (!force && developerToken && developerToken.expiresAt > now + 300) return developerToken.token;
  if (!developerTokenTask) {
    developerTokenTask = fetchDeveloperToken()
      .then((entry) => {
        developerToken = entry;
        return entry.token;
      })
      .finally(() => {
        developerTokenTask = null;
      });
  }
  return developerTokenTask;
};

/** 发起带 Apple Music 鉴权头的请求。 */
const requestAppleMusic = async (
  path: string,
  mediaUserToken: string,
  retry = true,
): Promise<Response> => {
  const token = await getDeveloperToken(!retry);
  const response = await fetch(`${APPLE_MUSIC_API}${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      Origin: APPLE_MUSIC_ORIGIN,
      "Media-User-Token": mediaUserToken,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 401 && retry) return requestAppleMusic(path, mediaUserToken, false);
  return response;
};

/** 将 Apple Music 搜索返回转换成候选歌曲。 */
const toAppleSongs = (payload: any, storefront: string): AppleMusicSong[] =>
  (payload?.results?.songs?.data ?? [])
    .filter((item: any) => item.attributes?.hasLyrics)
    .map((item: any) => ({
      id: String(item.id),
      title: String(item.attributes?.name ?? ""),
      artist: String(item.attributes?.artistName ?? ""),
      duration: Number(item.attributes?.durationInMillis ?? 0),
      isrc: String(item.attributes?.isrc ?? ""),
      storefront,
    }));

/** 获取订阅账户所在的 Apple Music 曲库地区。 */
const resolveStorefront = async (
  mediaUserToken: string,
  configured: string,
): Promise<string | null> => {
  if (configured.trim()) return configured.trim().toLowerCase();
  const response = await requestAppleMusic("/me/storefront", mediaUserToken);
  if (!response.ok) return null;
  const payload = await response.json();
  const storefront = payload?.data?.[0]?.id;
  return typeof storefront === "string" ? storefront.toLowerCase() : null;
};

/** 在一个曲库中搜索候选歌曲。 */
const searchStorefront = async (
  storefront: string,
  keyword: string,
  mediaUserToken: string,
): Promise<AppleMusicSong[]> => {
  const params = new URLSearchParams({ term: keyword, types: "songs", limit: "10" });
  const response = await requestAppleMusic(
    `/catalog/${storefront}/search?${params}`,
    mediaUserToken,
  );
  if (!response.ok) {
    coreLog.warn(`[appleMusicLyrics] 曲库 ${storefront} 搜索失败: HTTP ${response.status}`);
    return [];
  }
  return toAppleSongs(await response.json(), storefront);
};

/** 验证已保存令牌并实际发起一次 Apple Music 搜索。 */
export const verifyAppleMusicTTMLToken = async (): Promise<AppleMusicTTMLFetchResult> => {
  const mediaUserToken = getAppleMusicMediaUserToken();
  if (!mediaUserToken) return fetchResult("tokenMissing");
  const config = store.get("lyric");
  try {
    coreLog.info(
      `[appleMusicLyrics] 开始验证已保存 Media-User-Token: ${describeMediaUserToken(mediaUserToken)}`,
    );
    const storefront = await resolveStorefront(
      mediaUserToken,
      String(config.appleMusicStorefront ?? ""),
    );
    if (!storefront) return fetchResult("error", null, "storefront");
    const songs = await searchStorefront(storefront, "music", mediaUserToken);
    coreLog.info(
      `[appleMusicLyrics] 令牌验证完成: storefront=${storefront}, candidates=${songs.length}`,
    );
    return fetchResult("available", null, storefront);
  } catch (err) {
    coreLog.warn("[appleMusicLyrics] 令牌验证失败:", err);
    return fetchResult("error");
  }
};

/** 将外区候选桥接为账户曲库可请求歌词的歌曲 ID。 */
const resolveAccountSongId = async (
  song: AppleMusicSong,
  accountStorefront: string,
  mediaUserToken: string,
): Promise<string | null> => {
  if (song.storefront === accountStorefront) return song.id;
  const direct = await requestAppleMusic(
    `/catalog/${accountStorefront}/songs/${song.id}`,
    mediaUserToken,
  );
  if (direct.ok) return song.id;
  if (!song.isrc) return null;
  const params = new URLSearchParams({ "filter[isrc]": song.isrc });
  const response = await requestAppleMusic(
    `/catalog/${accountStorefront}/songs?${params}`,
    mediaUserToken,
  );
  if (!response.ok) return null;
  const match = (await response.json())?.data?.find((item: any) => item.attributes?.hasLyrics);
  return match?.id ? String(match.id) : null;
};

/** 写入有界内存歌词缓存。 */
const cacheLyric = (key: string, lyric: string): void => {
  lyricCache.delete(key);
  lyricCache.set(key, lyric);
  if (lyricCache.size > LYRIC_CACHE_LIMIT) lyricCache.delete(lyricCache.keys().next().value!);
};

/** 从 Apple Music 获取当前歌曲的 TTML 歌词；失败时返回 null。 */
const fetchAppleMusicTTMLResultUncached = async (
  track: Track,
): Promise<AppleMusicTTMLFetchResult> => {
  const config = store.get("lyric");
  if (!config.enableAppleMusicTTMLLyric) return fetchResult("disabled");
  const language = String(config.appleMusicTranslationLanguage ?? "zh-Hans-CN").trim();
  const script = String(config.appleMusicTranslationScript ?? "").trim();
  const cacheKey = buildCacheKey(track, language, script);
  const cached = getCachedTTML("appleMusic", cacheKey);
  if (cached !== "miss") {
    return cached
      ? fetchResult("available", cached, "cache")
      : fetchResult("noMatch", null, "cache");
  }
  const noMatch = (message?: string): AppleMusicTTMLFetchResult => {
    setCachedTTML("appleMusic", cacheKey, null);
    return fetchResult("noMatch", null, message);
  };
  const mediaUserToken = getAppleMusicMediaUserToken();
  if (!mediaUserToken) return fetchResult("tokenMissing");
  try {
    coreLog.info(
      `[appleMusicLyrics] 开始搜索: ${track.title} - ${track.artists.map((item) => item.name).join(" / ")}, token=${describeMediaUserToken(mediaUserToken)}`,
    );
    const accountStorefront = await resolveStorefront(
      mediaUserToken,
      String(config.appleMusicStorefront ?? ""),
    );
    if (!accountStorefront) {
      coreLog.warn("[appleMusicLyrics] 未能读取账号曲库地区");
      return fetchResult("error", null, "storefront");
    }
    const configuredRegions = String(config.appleMusicSearchRegions ?? "cn,jp,tw,kr")
      .split(",")
      .map((region) => region.trim().toLowerCase())
      .filter(Boolean);
    const storefronts = [...new Set([accountStorefront, ...configuredRegions])];
    const artist = track.artists.map((item) => item.name).join(" ");
    const keywords = [...new Set([`${track.title} ${artist}`.trim(), track.title].filter(Boolean))];
    const groups = await Promise.all(
      storefronts.flatMap((storefront) =>
        keywords.map((keyword) => searchStorefront(storefront, keyword, mediaUserToken)),
      ),
    );
    const candidates = groups.flat();
    const rawLevel = String(config.appleMusicMatchLevel ?? "standard");
    const level: AppleMusicMatchLevel =
      rawLevel === "strict" || rawLevel === "loose" ? rawLevel : "standard";
    const candidate = pickAppleMusicSong(track, candidates, level);
    coreLog.info(
      `[appleMusicLyrics] 搜索完成: storefront=${accountStorefront}, candidates=${candidates.length}, matchLevel=${level}, matched=${candidate?.id ?? "none"}`,
    );
    if (!candidate) return noMatch();
    const songId = await resolveAccountSongId(candidate, accountStorefront, mediaUserToken);
    if (!songId) {
      coreLog.info(`[appleMusicLyrics] 未能将候选桥接到账号曲库: ${candidate.id}`);
      return noMatch("bridge");
    }
    const memoryCacheKey = `${accountStorefront}:${songId}:${language}:${script}`;
    const cached = lyricCache.get(memoryCacheKey);
    if (cached) {
      coreLog.info(`[appleMusicLyrics] 命中内存歌词缓存: ${accountStorefront}:${songId}`);
      return fetchResult("available", cached, "cache");
    }
    const query = buildAppleMusicLyricQuery(language, script);
    let response = await requestAppleMusic(
      `/catalog/${accountStorefront}/songs/${songId}/syllable-lyrics?${query}`,
      mediaUserToken,
    );
    if (response.status === 404) {
      response = await requestAppleMusic(
        `/catalog/${accountStorefront}/songs/${songId}/lyrics?${query}`,
        mediaUserToken,
      );
    }
    if (!response.ok) {
      coreLog.warn(`[appleMusicLyrics] 歌词请求失败: song=${songId}, HTTP ${response.status}`);
      return noMatch(`lyrics:${response.status}`);
    }
    const attributes = (await response.json())?.data?.[0]?.attributes;
    const lyric = String(
      (typeof attributes?.ttmlLocalizations === "string" && attributes.ttmlLocalizations) ||
        attributes?.ttml ||
        "",
    );
    if (!lyric.trim()) {
      coreLog.info(`[appleMusicLyrics] 候选无可用 TTML: song=${songId}`);
      return noMatch("empty");
    }
    cacheLyric(memoryCacheKey, lyric);
    setCachedTTML("appleMusic", cacheKey, lyric);
    coreLog.info(`[appleMusicLyrics] 获取 TTML 成功: song=${songId}, chars=${lyric.length}`);
    return fetchResult("available", lyric);
  } catch (err) {
    coreLog.warn(`[appleMusicLyrics] ${track.title} fetch failed:`, err);
    return fetchResult("error");
  }
};

/** Apple Music 搜索请求去重；缓存命中时不会访问网络。 */
export const fetchAppleMusicTTMLResult = (track: Track): Promise<AppleMusicTTMLFetchResult> => {
  const key = JSON.stringify([track.source, track.id, track.title, track.artists]);
  const existing = inflight.get(key);
  if (existing) return existing;
  const request = fetchAppleMusicTTMLResultUncached(track).finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
};

/** 从 Apple Music 获取当前歌曲的 TTML 歌词；失败时返回 null。 */
export const fetchAppleMusicTTML = async (track: Track): Promise<string | null> =>
  (await fetchAppleMusicTTMLResult(track)).lyric;

/** 仅读取持久化缓存，不触发 Apple Music 网络请求。 */
export const getCachedAppleMusicTTML = (track: Track): string | null => {
  const config = store.get("lyric");
  if (!config.enableAppleMusicTTMLLyric) return null;
  const language = String(config.appleMusicTranslationLanguage ?? "zh-Hans-CN").trim();
  const script = String(config.appleMusicTranslationScript ?? "").trim();
  const cached = getCachedTTML("appleMusic", buildCacheKey(track, language, script));
  return cached === "miss" ? null : cached;
};
