import type { LyricSearchSource, LyricSourceSearchPage } from "@shared/types/lyrics";
import { isPlatform } from "@shared/types/platform";
import { searchSongs } from "@/apis/search";

/**
 * 逐来源搜索全部歌曲候选分页，不套用自动匹配的最佳候选过滤
 * @param source - 当前歌词来源
 * @param keyword - 用户输入的模糊关键词
 * @param offset - 当前页起点
 * @returns 五十条轻量元数据与服务端分页状态
 */
export const searchLyricVersions = async (
  source: LyricSearchSource,
  keyword: string,
  offset: number,
): Promise<LyricSourceSearchPage> => {
  const platform =
    source.origin === "amll"
      ? source.platform
      : isPlatform(source.origin)
        ? source.origin
        : undefined;
  if (!platform)
    return window.api.lyrics.searchSourceTracks(
      { origin: source.origin, platform: source.platform },
      keyword,
      offset,
    );
  const page = await searchSongs(platform, keyword, offset, 50);
  return {
    items: page.items.map((track) => ({
      id: platform === "qqmusic" ? (track.extId ?? track.id) : track.id,
      mid: platform === "qqmusic" && track.extId ? track.id : undefined,
      title: track.title,
      artists: track.artists.map((artist) => artist.name),
      album: track.album?.name,
      duration: track.duration,
    })),
    hasMore: page.hasMore,
    total: page.total,
  };
};
