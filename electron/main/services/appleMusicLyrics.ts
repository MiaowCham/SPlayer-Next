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
      hasTimeSyncedLyrics: Boolean(item.attributes?.hasTimeSyncedLyrics),
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
  const songs = (await response.json())?.data ?? [];
  // 优先桥接到具备逐字歌词的版本，否则退而求其次用任意有歌词的版本
  const match =
    songs.find((item: any) => item.attributes?.hasTimeSyncedLyrics) ??
    songs.find((item: any) => item.attributes?.hasLyrics);
  return match?.id ? String(match.id) : null;
};

/** 写入有界内存歌词缓存。 */
const cacheLyric = (key: string, lyric: string): void => {
  lyricCache.delete(key);
  lyricCache.set(key, lyric);
  if (lyricCache.size > LYRIC_CACHE_LIMIT) lyricCache.delete(lyricCache.keys().next().value!);
};

/**
 * 校验 TTML 是否为逐字歌词（Syllable-level）
 *
 * 只要主歌词中包含带 begin/end 时间戳的 <span> 即为逐字歌词。
 * 注意不能全局检查 itunes:timing="None"，因为内嵌的翻译段常被 Apple 标记为 None。
 * @param ttml - TTML 字符串
 */
const isSyllableTTML = (ttml: string | null): boolean => {
  if (!ttml || typeof ttml !== "string") return false;
  return /<span\b[^>]*\b(begin|end)\s*=/i.test(ttml);
};

/**
 * 预处理 TTML：将 Apple Music 的简体替换段 (translation type="replacement") 融合进主歌词中
 *
 * 严格保留背景歌词 (ttm:role="x-bg") 与逐字时间戳，清理冗余 xmlns 并更新根节点语言声明。
 * @param ttml - 原始 TTML 字符串
 * @returns 处理后的 TTML 字符串
 */
const applyReplacementTranslations = (ttml: string): string => {
  if (!ttml || typeof ttml !== "string") return ttml;

  // 1. 查找 replacement 类型的 translation 块（通常为 zh-Hans）
  const replacementRegex =
    /<translation\b[^>]*\btype=["']replacement["'][^>]*>([\s\S]*?)<\/translation>/i;
  const match = ttml.match(replacementRegex);
  if (!match) return ttml;

  const transTag = match[0];
  const replacementContent = match[1];
  const transLangMatch = transTag.match(/\bxml:lang=["']([^"']+)["']/i);
  const targetLang = transLangMatch ? transLangMatch[1] : "zh-Hans";

  // 2. 提取所有 <text for="KEY">CONTENT</text>，建立 key -> cleanContent 映射表
  const textRegex = /<text\b[^>]*\bfor=["']([^"']+)["'][^>]*>([\s\S]*?)<\/text>/gi;
  const replacementMap = new Map<string, string>();
  let textMatch: RegExpExecArray | null;
  while ((textMatch = textRegex.exec(replacementContent)) !== null) {
    const key = textMatch[1];
    let content = textMatch[2];
    content = content.replace(/\s+xmlns(?::\w+)?=["'][^"']+["']/g, "");
    replacementMap.set(key, content);
  }
  if (replacementMap.size === 0) return ttml;

  // 3. 将主歌词中对应 <p itunes:key="KEY"> 的内部歌词替换为简体内容
  let processedTtml = ttml.replace(
    /(<p\b([^>]*\bitunes:key=["']([^"']+)["'][^>]*)>)([\s\S]*?)(<\/p>)/gi,
    (fullMatch, openTag, _attrs, key, _originalContent, closeTag) => {
      const repContent = replacementMap.get(key);
      return repContent !== undefined ? `${openTag}${repContent}${closeTag}` : fullMatch;
    },
  );

  // 4. 移除已经应用融合的 <translation type="replacement"> 块
  processedTtml = processedTtml.replace(replacementRegex, "");
  processedTtml = processedTtml.replace(/<translations>\s*<\/translations>/gi, "");

  // 5. 更新根节点 <tt> 的 xml:lang 声明为目标语言
  return processedTtml.replace(
    /(<tt\b[^>]*\bxml:lang=["'])[^"']+([^>]*>)/i,
    `$1${targetLang}$2`,
  );
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
    if (!cached) return fetchResult("noMatch", null, "cache");
    // 旧版可能缓存了逐行歌词，校验不通过时清理并重抓
    if (!isSyllableTTML(cached)) {
      setCachedTTML("appleMusic", cacheKey, null);
      return fetchResult("noMatch", null, "cache");
    }
    return fetchResult("available", cached, "cache");
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
      if (isSyllableTTML(cached)) {
        coreLog.info(`[appleMusicLyrics] 命中内存歌词缓存: ${accountStorefront}:${songId}`);
        return fetchResult("available", cached, "cache");
      }
      lyricCache.delete(memoryCacheKey);
    }
    const query = buildAppleMusicLyricQuery(language, script);
    const response = await requestAppleMusic(
      `/catalog/${accountStorefront}/songs/${songId}/syllable-lyrics?${query}`,
      mediaUserToken,
    );
    if (response.status === 403) {
      coreLog.warn(`[appleMusicLyrics] Media-User-Token 无效或已过期: song=${songId}`);
      return noMatch("token");
    }
    if (!response.ok) {
      coreLog.warn(`[appleMusicLyrics] 歌词请求失败: song=${songId}, HTTP ${response.status}`);
      return noMatch(`lyrics:${response.status}`);
    }
    const attributes = (await response.json())?.data?.[0]?.attributes;
    if (!attributes) return noMatch("empty");
    // 仅保留逐字歌词：displayType=2 为逐行歌词，SPlayer 需要逐字时间轴
    if (attributes.displayType === 2 || String(attributes.displayType) === "2") {
      coreLog.info(`[appleMusicLyrics] 歌词为逐行类型 (displayType=2)，丢弃: song=${songId}`);
      return noMatch("displayType");
    }
    let lyric = String(
      (typeof attributes?.ttmlLocalizations === "string" && attributes.ttmlLocalizations) ||
        attributes?.ttml ||
        "",
    );
    if (!lyric.trim()) {
      coreLog.info(`[appleMusicLyrics] 候选无可用 TTML: song=${songId}`);
      return noMatch("empty");
    }
    // 严格校验逐字时间轴，避免逐行歌词被当作有效内容返回
    if (!isSyllableTTML(lyric)) {
      coreLog.info(`[appleMusicLyrics] TTML 为逐行歌词（无逐字 span 标记），丢弃: song=${songId}`);
      return noMatch("line");
    }
    // 预处理：将 Apple Music 简体替换段融合进主歌词
    lyric = applyReplacementTranslations(lyric);
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
  const key = buildCacheKey(track, language, script);
  const cached = getCachedTTML("appleMusic", key);
  if (cached === "miss" || !cached) return null;
  // 旧版本可能缓存了逐行歌词，校验不通过时清理并视为未命中
  if (!isSyllableTTML(cached)) {
    setCachedTTML("appleMusic", key, null);
    return null;
  }
  return cached;
};
