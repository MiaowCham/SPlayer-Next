/**
 * Apple Music 动态封面（editorialVideo motion artwork）
 *
 * 直接从 AMP API 取专辑的动效封面 HLS 地址，供非网易云来源的曲目借用，
 * 查询顺序为给定地区 → us → jp → cn，命中后按曲目元信息缓存
 */
import { coreLog } from "@main/utils/logger";
import type { AppleMusicMotionParams, AppleMusicMotionResult } from "@shared/types/appleMusic";
import { convertText } from "@main/services/opencc";
import { getDeveloperToken } from "./appleMusicLyrics";

const AMP_API = "https://amp-api.music.apple.com/v1";
const TIMEOUT_MS = 15_000;
const CACHE_LIMIT = 100;
/** 假名：日文曲目的判定依据 */
const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}\u30FC\uFF66-\uFF9F]/u;
/** 谚文：韩文曲目的判定依据 */
const HANGUL_RE = /[\p{Script=Hangul}]/u;
/** 汉字：中文曲目的判定依据 */
const HAN_RE = /\p{Script=Han}/u;
/** 日文新字体（中文不使用）：出现即可判定为日文汉字曲目 */
const JA_SHINJITAI_RE = /[楽図広気売駅円芸転伝沢浜桜鉄県検険厳塩縁剤斎徳]/u;

/** 日文曲目优先日本区，其次韩国区（两地日文曲库与动效封面覆盖更全） */
const KANA_STOREFRONTS = ["jp", "kr", "tw", "hk", "us"];
/** 韩文曲目优先韩国区，其次日本区（日区收录大量 K-pop 发行） */
const KOREAN_STOREFRONTS = ["kr", "jp", "tw", "hk", "us"];
/** 中文曲目优先港台区，中文发行在港台区收录更全 */
const HAN_STOREFRONTS = ["cn", "tw", "hk", "sg", "us", "jp"];
/** 西文曲目优先美加区：日区会把英文曲名本土化成片假名，反而不易命中 */
const LATIN_STOREFRONTS = ["us", "ca", "jp", "kr", "tw", "hk"];

/**
 * 按曲目文字种类决定地区回退顺序
 * @param title - 曲目名
 * @param artist - 歌手名
 * @returns 地区回退顺序
 */
const resolveStorefrontOrder = (title: string, artist: string): string[] => {
  const text = `${title}${artist}`;
  if (KANA_RE.test(text)) return KANA_STOREFRONTS;
  if (HANGUL_RE.test(text)) return KOREAN_STOREFRONTS;
  // 纯汉字标题也可能来自日文，命中日文新字体时优先日本区
  if (JA_SHINJITAI_RE.test(text)) return KANA_STOREFRONTS;
  if (HAN_RE.test(text)) return HAN_STOREFRONTS;
  return LATIN_STOREFRONTS;
};

/**
 * 缓存有效期：Apple 的节日动效封面会随时间替换，这里按 30 分钟重新校验
 */
const CACHE_TTL_MS = 30 * 60 * 1000;

interface MotionCacheEntry {
  /** 查询结果，未命中为 null */
  value: AppleMusicMotionResult | null;
  /** 写入时间戳 */
  at: number;
}

const cache = new Map<string, MotionCacheEntry>();

/**
 * 写入缓存并淘汰最旧条目
 * @param key - 曲目缓存键
 * @param value - 查询结果
 * @returns 原样返回查询结果
 */
const remember = (
  key: string,
  value: AppleMusicMotionResult | null,
): AppleMusicMotionResult | null => {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { value, at: Date.now() });
  return value;
};

/**
 * 读取未过期的缓存
 * @param key - 曲目缓存键
 * @returns 命中返回结果，过期或未命中返回 undefined
 */
const readCache = (key: string): AppleMusicMotionResult | null | undefined => {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
};

/**
 * 清除指定曲目的缓存，供播放器在视频加载失败时调用
 * @param params - 曲目元信息与商店地区
 */
export const invalidateAppleMusicMotionCover = (params: AppleMusicMotionParams): void => {
  cache.delete(`${params.storefront}|${params.songId ?? ""}|${params.title}|${params.artist}`);
};

/**
 * 请求 AMP API 并解析 JSON
 * @param path - 相对 v1 的路径
 * @param token - 开发者令牌
 * @returns 解析后的响应体
 */
const requestAmp = async (path: string, token: string): Promise<any> => {
  const response = await fetch(`${AMP_API}${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      Origin: "https://music.apple.com",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`AMP ${response.status}`);
  return response.json();
};

/**
 * 从专辑属性里取方图动效封面地址
 * @param album - 专辑资源
 * @returns HLS 地址，缺失时返回 null
 */
const readMotionUrl = (album: any): string | null => {
  const video = album?.attributes?.editorialVideo;
  return video?.motionDetailSquare?.video ?? video?.motionSquareVideo1x1?.video ?? null;
};

/**
 * 读取专辑静态封面地址（300x300），用于与曲目封面做指纹比对
 * @param album - 专辑资源
 * @returns 封面地址，缺失时返回 null
 */
const readArtworkUrl = (album: any): string | null => {
  const template = album?.attributes?.artwork?.url;
  if (typeof template !== "string") return null;
  return template.replace("{w}", "300").replace("{h}", "300");
};

/** 内容分级等元数据噪声：QQ/酷狗常把它拼进歌名或专辑名，比较前必须剥离 */
const NOISE_RE = /\b(explicit|clean|explicit version|clean version)\b/gi;

/** 归一化文本：去掉空格、标点与括号内容，便于比较曲名 */
const normalize = (text: string): string =>
  (text ?? "")
    .replace(NOISE_RE, "")
    .toLowerCase()
    .replace(/[(（\[【].*?[)）\]】]/g, "")
    .replace(
      /[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}a-z0-9]/gu,
      "",
    );

/**
 * 判断候选歌曲是否就是当前曲目
 *
 * 搜索会把翻唱、remix、同名不同曲排在前面，必须按曲名与歌手双重校验，
 * 否则会取到别的专辑的动效封面（表现为封面完全对不上）
 *
 * @param song - Apple Music 歌曲资源
 * @param params - 曲目元信息
 * @returns 是否为同一首歌
 */
/** 版本标记词：remix / live / cover 等，归一化会把括号去掉，必须单独比较 */
/** 专辑版本后缀：Encore / Deluxe 等属于不同发行，封面不同 */
const EDITION_RE =
  /(encore|deluxe|bonus|edition|remaster|expanded|anniversary|special|complete|collector)/i;
const VARIANT_RE =
  /(remix|live|cover|instrumental|karaoke|acoustic|version|edit|mix|sped ?up|nightcore|tribute|piano)/i;

/**
 * 提取文本里的版本标记
 * @param text - 曲名原文
 * @returns 标记词集合（小写）
 */
const variantsOf = (text: string): Set<string> =>
  new Set(
    (text.toLowerCase().match(new RegExp(VARIANT_RE.source, "gi")) ?? []).map((one) =>
      one.toLowerCase(),
    ),
  );

/**
 * 提取专辑版本标记
 * @param text - 专辑名
 * @returns 版本标记集合（小写）
 */
const editionsOf = (text: string): Set<string> =>
  new Set(
    (text.toLowerCase().match(new RegExp(EDITION_RE.source, "gi")) ?? []).map((one) =>
      one.toLowerCase(),
    ),
  );

/**
 * 判断专辑是否为同一发行
 *
 * 名称包含关系不足以判断，`The Life of a Showgirl` 与 `... : The Encore` 属于不同发行，
 * 封面不同，因此曲目侧的版本标记必须全部出现在候选侧
 *
 * @param trackAlbum - 曲目专辑名
 * @param candidateAlbum - 候选专辑名
 * @returns 是否可视为同一发行
 */
const isSameAlbum = (trackAlbum: string, candidateAlbum: string): boolean => {
  const track = normalize(trackAlbum);
  const candidate = normalize(candidateAlbum);
  if (!track || !candidate) return true;
  const candidateEditions = editionsOf(candidateAlbum);
  for (const edition of editionsOf(trackAlbum)) {
    if (!candidateEditions.has(edition)) return false;
  }
  return track === candidate || track.includes(candidate) || candidate.includes(track);
};

/**
 * 计算两个专辑名的相似度（归一化后的公共前缀占比）
 *
 * 同曲不同发行时专辑名往往只差一个后缀，用相似度挑最接近的一个，
 * 避免因为名称不完全相同就放弃动态封面
 *
 * @param trackAlbum - 曲目专辑名
 * @param candidateAlbum - 候选专辑名
 * @returns 0 到 1 之间的相似度
 */
const albumSimilarity = (trackAlbum: string, candidateAlbum: string): number => {
  const a = normalize(trackAlbum);
  const b = normalize(candidateAlbum);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const limit = Math.min(a.length, b.length);
  let common = 0;
  while (common < limit && a[common] === b[common]) common++;
  return common / Math.max(a.length, b.length);
};

const isSameSong = (song: any, params: AppleMusicMotionParams): boolean => {
  const rawName = song?.attributes?.name ?? "";
  const name = normalize(rawName);
  const title = normalize(params.title);
  if (!name || !title) return false;
  if (name !== title) return false;
  // 曲名相同但版本不同（remix/live/cover）时封面通常不同，必须排除
  const songVariants = variantsOf(rawName);
  for (const variant of variantsOf(params.title)) {
    if (!songVariants.has(variant)) return false;
  }
  const artist = normalize(song?.attributes?.artistName ?? "");
  const target = normalize(params.artist);
  if (target && !(artist === target || artist.includes(target) || target.includes(artist)))
    return false;
  // 同一首歌在不同发行（单曲/专辑/Deluxe）里封面不同，专辑名不一致时不能借用动效封面
  return true;
};

/**
 * 取歌手串里的第一位歌手
 *
 * 搜索结果对超长检索词不友好：把整串合作歌手拼进去往往直接返回 0 条，
 * 因此只用第一位歌手参与检索，匹配阶段仍按完整歌手串校验
 *
 * @param artist - 完整歌手串
 * @returns 第一位歌手，取不到时返回空串
 */
const primaryArtistOf = (artist: string | undefined): string =>
  (artist ?? "")
    .split(/[,，&/、;；]+/u)
    .map((name) => name.trim())
    .find((name) => name.length > 0) ?? "";

/**
 * 按地区生成候选检索词
 *
 * 港台区曲库多用繁体标题、大陆区为简体，直接用元数据原文常常匹配不到，
 * 因此在原文未命中时补一次简繁转换后的检索
 *
 * @param term - 原始检索词
 * @param storefront - 商店地区
 * @returns 依次尝试的检索词
 */
const searchTerms = (term: string, storefront: string): string[] => {
  const mode =
    storefront === "tw"
      ? "s2tw"
      : storefront === "hk"
        ? "s2hk"
        : storefront === "cn" || storefront === "sg"
          ? "t2s"
          : null;
  if (!mode) return [term];
  const converted = convertText(term, mode);
  return converted && converted !== term ? [term, converted] : [term];
};

/**
 * 在指定地区查询曲目所属专辑的动效封面
 *
 * 先按歌名找到同一首歌（可命中多个不同发行的候选），再逐个取专辑动效封面，
 * 用专辑相似度挑最接近的一个：名称一致或版本一致直接采用，
 * 否则要求相似度达到阈值，避免借用毫不相干的发行封面
 *
 * @param storefront - 商店地区
 * @param params - 曲目元信息
 * @param token - 开发者令牌
 * @returns HLS 地址，未命中返回 null
 */
const lookupInStorefront = async (
  storefront: string,
  params: AppleMusicMotionParams,
  token: string,
): Promise<{ url: string; artwork: string | null; exact: boolean } | null> => {
  const considerAlbum = async (
    album: any,
  ): Promise<{ url: string; score: number; artwork: string | null; exact: boolean } | null> => {
    const url = readMotionUrl(album);
    if (!url) return null;
    const albumName = album?.attributes?.name ?? "";
    const artwork = readArtworkUrl(album);
    if (isSameAlbum(params.album ?? "", albumName)) return { url, score: 1, artwork, exact: true };
    return {
      url,
      score: albumSimilarity(params.album ?? "", albumName),
      artwork,
      exact: false,
    };
  };

  let best: { url: string; score: number; artwork: string | null; exact: boolean } | null = null;
  const keepBest = (
    candidate: { url: string; score: number; artwork: string | null; exact: boolean } | null,
  ): void => {
    if (candidate && (!best || candidate.score > best.score)) best = candidate;
  };

  if (params.songId) {
    const data = await requestAmp(
      `/catalog/${storefront}/songs/${params.songId}?include=albums&extend=editorialVideo`,
      token,
    );
    keepBest(await considerAlbum(data?.data?.[0]?.relationships?.albums?.data?.[0]));
  }

  // 检索词从窄到宽：歌名 + 主歌手 → 仅歌名；过长检索词可能直接返回 0 条
  const primaryArtist = primaryArtistOf(params.artist);
  const songTermCandidates = [
    `${params.title} ${primaryArtist}`.trim(),
    params.title.trim(),
  ].filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);
  for (const baseTerm of songTermCandidates) {
    for (const searchTerm of searchTerms(baseTerm, storefront)) {
      const search = await requestAmp(
        `/catalog/${storefront}/search?term=${encodeURIComponent(searchTerm)}&types=songs&limit=10`,
        token,
      );
      const allSongs: any[] = search?.results?.songs?.data ?? [];
      const songs: any[] = allSongs.filter((song) => isSameSong(song, params));
      coreLog.info(
        `[am-motion] ${storefront} songs=${allSongs.length} matched=${songs.length} term=${searchTerm}`,
      );
      for (const song of songs.slice(0, 5)) {
        const detail = await requestAmp(
          `/catalog/${storefront}/songs/${song.id}?include=albums&extend=editorialVideo`,
          token,
        );
        keepBest(await considerAlbum(detail?.data?.[0]?.relationships?.albums?.data?.[0]));
      }
      if (best && (best as { score: number }).score >= 0.99) break;
    }
  }

  // 歌曲搜索可能只返回标准版/单曲，专辑版（如 The Encore）搜不到对应歌曲，
  // 因此再按专辑名直接搜专辑，命中同名专辑即取它的动效封面
  const albumTermCandidates = params.album
    ? [params.album.trim(), `${params.album} ${primaryArtist}`.trim()].filter(
        (value, index, list) => Boolean(value) && list.indexOf(value) === index,
      )
    : [];
  for (const albumTerm of albumTermCandidates) {
    for (const searchTerm of searchTerms(albumTerm, storefront)) {
      const search = await requestAmp(
        `/catalog/${storefront}/search?term=${encodeURIComponent(searchTerm)}&types=albums&limit=10&extend=editorialVideo`,
        token,
      );
      const albums: any[] = search?.results?.albums?.data ?? [];
      let usable = 0;
      for (const album of albums) {
        const candidate = await considerAlbum(album);
        if (candidate) usable++;
        keepBest(candidate);
      }
      coreLog.info(
        `[am-motion] ${storefront} albums=${albums.length} withMotion=${usable} best=${(best as { score: number } | null)?.score ?? 0} term=${searchTerm}`,
      );
      if (best && (best as { score: number }).score >= 0.99) break;
    }
  }

  // 专辑名几乎一致（≥0.9）才允许借用；明显不同则放弃，避免串封面
  const chosen = best as {
    url: string;
    score: number;
    artwork: string | null;
    exact: boolean;
  } | null;
  coreLog.info(
    `[am-motion] ${storefront} chosen=${chosen ? `${chosen.score.toFixed(2)} exact=${chosen.exact}` : "none"}`,
  );
  if (!chosen || chosen.score < 0.9) return null;
  return { url: chosen.url, artwork: chosen.artwork, exact: chosen.exact };
};

/**
 * 查询曲目的动态封面
 * @param params - 曲目元信息与商店地区
 * @returns 命中返回 HLS 地址，未命中返回 null
 */
export const getAppleMusicMotionCover = async (
  params: AppleMusicMotionParams,
): Promise<AppleMusicMotionResult | null> => {
  const key = `${params.storefront}|${params.songId ?? ""}|${params.title}|${params.artist}`;
  const cached = readCache(key);
  if (cached !== undefined) return cached;

  try {
    const token = await getDeveloperToken();
    coreLog.info(
      `[am-motion] start ${params.title} / ${params.artist} / album=${params.album ?? "-"} / song=${params.songId ?? "-"} / sf=${params.storefront}`,
    );
    const storefronts = [
      params.storefront,
      ...resolveStorefrontOrder(params.title, params.artist),
    ].filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);
    for (const storefront of storefronts) {
      const motion = await lookupInStorefront(storefront, params, token);
      if (motion) {
        coreLog.info(`[am-motion] hit ${storefront} ${params.title} -> ${motion.url.slice(0, 80)}`);
        return remember(key, motion);
      }
    }
    coreLog.info(`[am-motion] miss ${params.title} - ${params.artist}`);
    return remember(key, null);
  } catch (error) {
    coreLog.warn(`[am-motion] failed ${params.title}: ${(error as Error).message}`);
    return remember(key, null);
  }
};
