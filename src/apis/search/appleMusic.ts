/**
 * Apple Music 搜索（渲染层）
 *
 * 搜索走主进程的 iTunes Search 代理（需要按地区切换、且无 CORS 头）；
 * 播放走「Apple Music 音源」插件的 musicUrl 能力，未安装插件时退化为 30 秒试听。
 */
import type { Track } from "@shared/types/player";
import type { AppleMusicSong } from "@shared/types/appleMusic";
import type { PluginInfo } from "@shared/types/plugin";
import { usePluginsStore } from "@/stores/plugins";
import { useSettingsStore } from "@/stores/settings";
import type { SearchResult } from "./index";

/** 已知的 Apple Music 音源插件 id 与它声明的源 key */
const AM_PLUGIN_ID = "1412.applemusic";
const AM_SOURCE_KEY = "am";

/**
 * 找出可用的 Apple Music 音源插件
 * 优先匹配已知 id，其次任意声明了 musicUrl 且名为 Apple Music 的源
 * @returns 可用的插件信息，未安装或未就绪时返回 undefined
 */
const findAppleMusicPlugin = (): PluginInfo | undefined => {
  const plugins = usePluginsStore();
  let fallback: PluginInfo | undefined;
  for (const info of plugins.list) {
    if (!info.enabled || info.status.state !== "ready") continue;
    if (info.manifest.id === AM_PLUGIN_ID) return info;
    const capability = info.status.sources[AM_SOURCE_KEY];
    if (
      !fallback &&
      capability?.actions.includes("musicUrl") &&
      capability.name === "Apple Music"
    ) {
      fallback = info;
    }
  }
  return fallback;
};

/**
 * 当前是否已安装并启用 Apple Music 音源插件
 * @returns 插件就绪时为 true；否则只能播放 30 秒试听
 */
export const hasAppleMusicPlugin = (): boolean => findAppleMusicPlugin() !== undefined;

/**
 * 把搜索结果转成曲目；插件可用时交给插件解析音频流，否则退回试听
 * @param song - iTunes 目录条目
 * @param storefront - 当前商店地区，插件解析时也需要
 * @param plugin - 可用的 Apple Music 音源插件
 * @returns 播放器可消费的曲目
 */
const toTrack = (
  song: AppleMusicSong,
  storefront: string,
  plugin: PluginInfo | undefined,
): Track => {
  const common = {
    id: song.id,
    title: song.title,
    artists: [{ id: song.artistId, name: song.artistName }],
    album: { id: song.albumId, name: song.albumName, cover: song.coverUrl },
    duration: song.durationMs,
    cover: song.coverUrl,
    // 插件解析失败时用它兜底，保证至少能播 30 秒试听
    previewUrl: song.previewUrl,
  };

  // 插件信息始终挂在曲目上：搜索时插件可能尚未就绪，播放时再判断能否走插件
  const pluginMeta = {
    pluginId: plugin?.manifest.id ?? AM_PLUGIN_ID,
    source: AM_SOURCE_KEY,
    musicInfo: {
      id: song.id,
      songmid: song.id,
      name: song.title,
      singer: song.artistName,
      album: song.albumName,
      durationMs: song.durationMs,
      cover: song.coverUrl,
      storefront,
    },
  };

  return plugin
    ? { ...common, source: "plugin", plugin: pluginMeta }
    : { ...common, source: "appleMusic", plugin: pluginMeta };
};

/**
 * 搜索 Apple Music 歌曲
 * @param keyword - 关键词
 * @param offset - 偏移量
 * @param limit - 单页数量
 * @returns 歌曲搜索结果
 */
export const songs = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<Track>> => {
  const storefront = useSettingsStore().player.appleMusicStorefront;
  const result = await window.api.appleMusic.search({
    kind: "songs",
    keyword,
    storefront,
    offset,
    limit,
  });
  const plugin = findAppleMusicPlugin();
  const items = (result.songs ?? []).map((song) => toTrack(song, storefront, plugin));
  return { items, total: items.length, hasMore: result.hasMore };
};

/**
 * Apple Music 不支持专辑/歌手/歌单的站内详情页，这里返回空结果
 * @returns 空的分页结果
 */
export const albums = async (): Promise<SearchResult<never>> => ({
  items: [],
  total: 0,
  hasMore: false,
});

/** 同 albums，Apple Music 没有歌手详情页 */
export const artists = async (): Promise<SearchResult<never>> => ({
  items: [],
  total: 0,
  hasMore: false,
});

/** 同 albums，Apple Music 没有歌单搜索 */
export const playlists = async (): Promise<SearchResult<never>> => ({
  items: [],
  total: 0,
  hasMore: false,
});
