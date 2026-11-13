/**
 * Apple Music 目录搜索
 *
 * 使用 iTunes Search API（公开、免鉴权、按 country 切换商店）拿到曲目元数据；
 * 实际音频流由「Apple Music 音源」插件（musicUrl 能力）解析，本服务只负责搜索。
 */
import type {
  AppleMusicAlbum,
  AppleMusicArtist,
  AppleMusicSearchParams,
  AppleMusicSearchResult,
  AppleMusicSong,
} from "@shared/types/appleMusic";
import { net } from "electron";
import { coreLog } from "@main/utils/logger";

const SEARCH_ENDPOINT = "https://itunes.apple.com/search";
const TIMEOUT_MS = 15_000;
const DEFAULT_STOREFRONT = "us";

/** iTunes 响应中的一条记录，字段随 entity 变化 */
interface ITunesRecord {
  trackId?: number;
  trackName?: string;
  artistId?: number;
  artistName?: string;
  collectionId?: number;
  collectionName?: string;
  trackTimeMillis?: number;
  trackCount?: number;
  artworkUrl100?: string;
  previewUrl?: string;
}

interface ITunesResponse {
  resultCount?: number;
  results?: ITunesRecord[];
}

/** entity 映射 */
const ENTITY_BY_KIND = {
  songs: "song",
  albums: "album",
  artists: "musicArtist",
} as const;

/**
 * 把 100x100 的封面地址提升到 300x300，与列表展示尺寸匹配
 * @param url - iTunes 原始封面地址
 * @returns 放大后的地址
 */
const upscaleArtwork = (url: string | undefined): string | undefined =>
  url?.replace(/\/\d+x\d+bb\./u, "/300x300bb.");

/**
 * 归一化商店地区，非法值回落到美国区
 * @param storefront - 用户选择或默认的地区
 * @returns 两位小写国家码
 */
const normalizeStorefront = (storefront: string | undefined): string => {
  const value = (storefront ?? "").trim().toLowerCase();
  return /^[a-z]{2}$/u.test(value) ? value : DEFAULT_STOREFRONT;
};

/**
 * 调用 iTunes Search 并归一化结果
 * @param params - 搜索入参
 * @returns 归一化后的结果
 */
export const searchAppleMusic = async (
  params: AppleMusicSearchParams,
): Promise<AppleMusicSearchResult> => {
  const keyword = params.keyword.trim();
  if (!keyword) return { hasMore: false };

  const storefront = normalizeStorefront(params.storefront);
  const limit = Math.max(1, Math.min(params.limit || 30, 200));
  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("term", keyword);
  url.searchParams.set("country", storefront);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", ENTITY_BY_KIND[params.kind]);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(Math.max(0, params.offset || 0)));
  url.searchParams.set("lang", "en_us");

  // 用 Electron 的 net.fetch：走系统代理，与内置在线接口一致
  const response = await net.fetch(url.toString(), {
    headers: { "User-Agent": "SPlayer-Next" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    coreLog.warn(`[appleMusic] search failed: HTTP ${response.status}`);
    throw new Error(`Apple Music 搜索失败（HTTP ${response.status}）`);
  }

  const body = (await response.json()) as ITunesResponse;
  const records = body.results ?? [];
  const hasMore = records.length >= limit;

  if (params.kind === "songs") {
    const songs: AppleMusicSong[] = records
      .filter((item) => item.trackId && item.trackName)
      .map((item) => ({
        id: String(item.trackId),
        title: item.trackName!,
        artistName: item.artistName ?? "",
        artistId: item.artistId ? String(item.artistId) : undefined,
        albumName: item.collectionName ?? "",
        albumId: item.collectionId ? String(item.collectionId) : undefined,
        durationMs: item.trackTimeMillis ?? 0,
        coverUrl: upscaleArtwork(item.artworkUrl100),
        previewUrl: item.previewUrl,
      }));
    return { songs, hasMore };
  }

  if (params.kind === "albums") {
    const albums: AppleMusicAlbum[] = records
      .filter((item) => item.collectionId && item.collectionName)
      .map((item) => ({
        id: String(item.collectionId),
        title: item.collectionName!,
        artistName: item.artistName ?? "",
        coverUrl: upscaleArtwork(item.artworkUrl100),
        trackCount: item.trackCount,
      }));
    return { albums, hasMore };
  }

  const artists: AppleMusicArtist[] = records
    .filter((item) => item.artistId && item.artistName)
    .map((item) => ({
      id: String(item.artistId),
      name: item.artistName!,
      coverUrl: upscaleArtwork(item.artworkUrl100),
    }));
  return { artists, hasMore };
};
