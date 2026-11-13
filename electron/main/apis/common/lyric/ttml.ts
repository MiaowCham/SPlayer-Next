/**
 * AMLL TTML DB 抓取
 *
 * 设计：
 * - 平台歌曲优先用配置的镜像模板，未配置时使用官方接口
 *   - NCM → "ncm-lyrics"
 *   - QM  → "qq-lyrics"（mid 或数字 id 都可能命中，由调用方传入候选）
 * - 词库搜索结果使用 AMLL 条目 ID，与平台歌曲 ID 分开缓存
 */

import { coreLog } from "@main/utils/logger";
import { appVersion } from "@main/utils/config";
import { store } from "@main/store";
import type { LyricSourceSearchPage } from "@shared/types/lyrics";
import {
  getCachedTTML,
  deleteTtmlVersionCache,
  setCachedTTML,
  type Platform as TtmlPlatform,
} from "@main/database/lyricTtmlCache";

const TIMEOUT_MS = 8000;
const OFFICIAL_API = "https://api.amll.dev/v1/lyrics";
const USER_AGENT = `SPlayer-Next/${appVersion} (https://github.com/SPlayer-Dev/SPlayer-Next)`;
const SEARCH_PAGE_SIZE = 50;

type LookupSource = Exclude<TtmlPlatform, "appleMusic">;

const inflight = new Map<string, Promise<string | null>>();

/**
 * 抓取并缓存一个 AMLL 版本，平台查询可走配置的镜像
 * @param source - 平台 ID 类型或词库条目
 * @param id - 来源的精确标识
 * @returns TTML 正文
 */
const doFetch = async (source: LookupSource, id: string): Promise<string | null> => {
  // 开关关闭时短路，让预热调用零成本
  if (!store.get("lyric.enableOnlineTTMLLyric")) return null;

  const cached = getCachedTTML(source, id);
  if (cached !== "miss") return cached;

  const template = source === "amll" ? "" : store.get("lyric.amllDbServer").trim();
  if (template && (!template.includes("%p") || !template.includes("%s"))) return null;
  const directory = source === "netease" ? "ncm-lyrics" : "qq-lyrics";
  const parameter = { netease: "ncmMusicId", qqmusic: "qqMusicId", amll: "id" }[source];
  const encodedId = encodeURIComponent(id);
  const url = template
    ? template.replace("%p", directory).replace("%s", encodedId)
    : `${OFFICIAL_API}/get?${parameter}=${encodedId}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 200) {
      const content = template
        ? await res.text()
        : ((await res.json()) as { data: { lyrics?: string } }).data.lyrics;
      const lyric = content?.trim() ? content : null;
      setCachedTTML(source, id, lyric);
      return lyric;
    }
    if (res.status === 404) {
      setCachedTTML(source, id, null);
      return null;
    }
    // 其它状态码（5xx 等）不写缓存，下次重试
    coreLog.warn(`[ttml] ${source}:${id} HTTP ${res.status}`);
    return null;
  } catch (err) {
    coreLog.warn(`[ttml] ${source}:${id} fetch failed:`, err);
    return null;
  }
};

/**
 * 复用同一来源和标识的在途抓取
 * @param platform - 查找来源
 * @param id - 歌曲或词库条目标识
 * @returns TTML 正文
 */
const fetchOne = (platform: LookupSource, id: string): Promise<string | null> => {
  const key = `${platform}:${id}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = doFetch(platform, id).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
};

/**
 * 依次尝试多个候选 id，命中即停。
 * - NCM 通常只传 [id]
 * - QM 传 [mid, id]：AMLL DB 里两种 key 都可能存在，逐一回落
 * 失败的 id 会被写入负缓存，后续重试零网络。
 */
export const fetchTTML = async (
  platform: Exclude<LookupSource, "amll">,
  ids: readonly string[],
): Promise<string | null> => {
  for (const id of ids) {
    if (!id) continue;
    const result = await fetchOne(platform, id);
    if (result) return result;
  }
  return null;
};

/**
 * 预热抓取：在 id 已确定的最早瞬间发出 TTML 请求。
 * 渲染端后续的 fetchTTMLOverlay 调用会通过 inflight Map 复用同一个 Promise。
 */
export const prefetchTTML = (
  platform: Exclude<LookupSource, "amll">,
  ids: readonly string[],
): void => {
  void fetchTTML(platform, ids);
};

/**
 * 等待同平台抓取结束后清理目标正文，避免迟到请求重新写入旧缓存
 * @param platform - TTML 平台
 * @param content - 目标版本正文
 * @param id - 已知的精确缓存键
 * @returns 被清理的远端曲目标识
 */
export const invalidateTTMLVersion = async (
  platform: LookupSource,
  content: string,
  id?: string,
): Promise<string[]> => {
  await Promise.allSettled(
    [...inflight.entries()]
      .filter(([key]) => key.startsWith(platform + ":"))
      .map(([, request]) => request),
  );
  return deleteTtmlVersionCache(platform, content, id);
};

/**
 * 通过 AMLL 歌词库条目标识抓取正文
 * @param id - AMLL 歌词库条目标识
 * @returns TTML 正文
 */
export const fetchTTMLById = (id: string): Promise<string | null> => fetchOne("amll", id);

/**
 * 搜索 AMLL 歌词库并按页返回轻量元数据
 * @param keyword - 用户输入的歌名或关键词
 * @param offset - 本页起点
 * @returns AMLL 歌词库条目和分页状态
 */
export const searchTTMLVersions = async (
  keyword: string,
  offset: number,
): Promise<LyricSourceSearchPage> => {
  if (!store.get("lyric.enableOnlineTTMLLyric")) return { items: [], hasMore: false, total: 0 };
  const query = new URLSearchParams({
    q: keyword,
    page: String(Math.floor(offset / SEARCH_PAGE_SIZE) + 1),
    pageSize: String(SEARCH_PAGE_SIZE),
  });
  const response = await fetch(`${OFFICIAL_API}/search?${query}`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`AMLL 歌词搜索失败 (${response.status})`);
  const { data } = (await response.json()) as {
    data: {
      items: { id: number; musicNames: string[]; artistNames: string[]; albumNames: string[] }[];
      pagination: { hasMore: boolean; total: number };
    };
  };
  return {
    items: data.items.map(({ id, musicNames, artistNames, albumNames }) => ({
      id: String(id),
      title: musicNames[0] ?? "",
      artists: artistNames,
      album: albumNames[0],
      duration: 0,
    })),
    hasMore: data.pagination.hasMore,
    total: data.pagination.total,
  };
};
