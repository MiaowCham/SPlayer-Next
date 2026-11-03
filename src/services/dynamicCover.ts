/**
 * 动态封面统一解析
 *
 * 网易云走站内动态封面接口（mp4）；其余来源借用 Apple Music 的 editorialVideo
 * 动效封面（HLS），按标题与歌手匹配，命中后按曲目缓存
 */
import * as neteaseSearch from "@/apis/search/netease";
import { getDynamicCover } from "@/apis/song/netease";
import type { Track } from "@shared/types/player";

export interface DynamicCoverResult {
  /** 视频地址 */
  url: string;
  /** 视频格式：mp4 可直接播放，hls 需要 MSE */
  format: "mp4" | "hls";
  /** 候选专辑的静态封面，用于判断是否与曲目封面同一张 */
  artwork?: string | null;
  /** 专辑名是否精确命中 */
  exact?: boolean;
}

const CACHE_LIMIT = 60;
const cache = new Map<string, DynamicCoverResult | null>();

/**
 * 写入缓存并淘汰最旧条目
 * @param key - 曲目缓存键
 * @param value - 解析结果
 * @returns 原样返回解析结果
 */
const remember = (key: string, value: DynamicCoverResult | null): DynamicCoverResult | null => {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, value);
  return value;
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

/** 版本标记词：remix / live / cover 等，归一化会去掉括号，需要单独比较 */
/** 专辑版本后缀：Encore / Deluxe 等属于不同发行，封面不同 */
const EDITION_RE =
  /(encore|deluxe|bonus|edition|remaster|expanded|anniversary|special|complete|collector)/i;
const VARIANT_RE =
  /(remix|live|cover|instrumental|karaoke|acoustic|version|edit|mix|sped ?up|nightcore|tribute|piano)/i;

/**
 * 提取曲名里的版本标记
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

/**
 * 按曲名与歌手在网易云找同一首歌
 *
 * 网易云的动态封面只接受站内歌曲 ID，非网易云来源需要先匹配到对应曲目
 *
 * @param track - 当前曲目
 * @returns 命中返回网易云歌曲 ID，否则返回 null
 */
const findNeteaseSongId = async (track: Track): Promise<string | null> => {
  const artist = track.artists
    ?.map((item) => item.name)
    .filter(Boolean)
    .join(" ");
  const keyword = `${track.title} ${artist ?? ""}`.trim();
  if (!keyword) return null;
  try {
    const result = await neteaseSearch.songs(keyword, 0, 10);
    const title = normalize(track.title);
    const targetArtist = normalize(artist ?? "");
    let best: { id: string; score: number } | null = null;
    for (const item of result.items) {
      const name = normalize(item.title);
      if (!name || name !== title) continue;
      // 版本标记必须一致，否则会拿到 remix / live 等其他封面的动态封面
      const itemVariants = variantsOf(item.title);
      let variantOk = true;
      for (const variant of variantsOf(track.title)) {
        if (!itemVariants.has(variant)) {
          variantOk = false;
          break;
        }
      }
      if (!variantOk) continue;
      const names = normalize(item.artists?.map((one) => one.name).join(" "));
      if (
        targetArtist &&
        !(names === targetArtist || names.includes(targetArtist) || targetArtist.includes(names))
      )
        continue;
      const albumName = item.album?.name ?? "";
      // 专辑一致直接采用；否则按相似度取最接近的一个
      const score = isSameAlbum(track.album?.name ?? "", albumName)
        ? 1
        : albumSimilarity(track.album?.name ?? "", albumName);
      if (!best || score > best.score) best = { id: item.id, score };
    }
    // 相似度不足则不借用，避免封面串图
    const chosen = best as { id: string; score: number } | null;
    return chosen && chosen.score >= 0.9 ? chosen.id : null;
  } catch {
    return null;
  }
};

/**
 * 解析曲目的动态封面
 * @param track - 当前曲目
 * @param storefront - Apple Music 商店地区
 * @param allowNetease - 是否允许查询网易云站内动态封面
 * @returns 命中返回地址与格式，未命中返回 null
 */
export const resolveDynamicCover = async (
  track: Track,
  storefront: string,
  allowNetease: boolean,
): Promise<DynamicCoverResult | null> => {
  const key = `${track.source}:${track.id}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  // 网易云站内动态封面优先；非网易云来源先按歌名匹配到网易云曲目再取
  if (allowNetease) {
    const neteaseId = track.source === "netease" ? track.id : await findNeteaseSongId(track);
    if (neteaseId) {
      const url = await getDynamicCover(neteaseId);
      if (url) return remember(key, { url, format: "mp4" });
    }
  }

  const artist = track.artists
    ?.map((item) => item.name)
    .filter(Boolean)
    .join(" ");
  const motion = await window.api.appleMusic.motion({
    title: track.title,
    artist: artist ?? "",
    album: track.album?.name,
    songId: track.source === "appleMusic" ? track.id : undefined,
    storefront,
  });
  return remember(key, motion ? { url: motion.url, format: "hls", artwork: motion.artwork } : null);
};

/**
 * 失效单曲的动态封面缓存
 *
 * 视频加载失败通常意味着 Apple 已撤下该资源（节日限定封面过期），
 * 此时同时清掉渲染层缓存与主进程缓存，下次播放重新解析
 *
 * @param track - 当前曲目
 * @param storefront - Apple Music 商店地区
 */
export const invalidateDynamicCover = (track: Track, storefront: string): void => {
  cache.delete(`${track.source}:${track.id}`);
  const artist = track.artists
    ?.map((item) => item.name)
    .filter(Boolean)
    .join(" ");
  window.api.appleMusic.motionInvalidate({
    title: track.title,
    artist: artist ?? "",
    album: track.album?.name,
    songId: track.source === "appleMusic" ? track.id : undefined,
    storefront,
  });
};

/** 清空缓存（切换账号或强制刷新时使用） */
export const clearDynamicCoverCache = (): void => cache.clear();
