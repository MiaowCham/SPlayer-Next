import type { Track, TrackSource } from "@shared/types/player";
import type { Collection, CollectionType } from "@/types/collection";

/**
 * 取在线平台的歌曲分享链接
 * @param track - 当前歌曲，本地/流媒体/不支持平台返回 null
 */
export const getTrackShareUrl = (track: Track | null | undefined): string | null => {
  if (!track?.id) return null;
  switch (track.source) {
    case "netease":
      return `https://music.163.com/#/song?id=${track.id}`;
    case "qqmusic":
      return `https://y.qq.com/n/ryqq_v2/songDetail/${track.id}`;
    case "kugou":
      return `https://www.kugou.com/mixsong/${track.id}.html`;
    default:
      return null;
  }
};

/**
 * 取歌词候选来源平台的原链接：优先跳到候选/当前曲目的详情页（按各平台链接格式拼接），
 * 缺曲目 ID 时回退为该平台按关键词的搜索页。
 * @param origin - 候选来源（平台或内置来源）
 * @param extra - 候选携带的平台额外字段（曲目 id / mid / hash）
 * @param track - 当前歌曲（同源时用 track.id；用于构造搜索关键词）
 * @returns 来源链接；无对应平台返回 null
 */
export const getLyricSourceUrl = (
  origin: string,
  extra: { id?: string; mid?: string; hash?: string } | undefined,
  track: Pick<Track, "source" | "id" | "title" | "artists"> | null | undefined,
): string | null => {
  const keyword = [track?.title, track?.artists?.map((a) => a.name).join(" ")]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
  const query = keyword ? encodeURIComponent(keyword) : "";

  switch (origin) {
    case "netease": {
      const id = extra?.id ?? (track?.source === origin ? track.id : undefined);
      return id ? `https://music.163.com/#/song?id=${id}` : query ? `https://music.163.com/#/search/m/?s=${query}` : null;
    }
    case "qqmusic": {
      // QQ 详情页支持数字 id 或 mid
      const id = extra?.id ?? extra?.mid ?? (track?.source === origin ? track.id : undefined);
      return id ? `https://y.qq.com/n/ryqq_v2/songDetail/${id}` : query ? `https://y.qq.com/n/ryqq/search?w=${query}&t=song&remoteplace=txt.yqq.center` : null;
    }
    case "kugou": {
      const id = extra?.hash ?? (track?.source === origin ? track.id : undefined);
      return id ? `https://www.kugou.com/mixsong/${id}.html` : query ? `https://www.kugou.com/yy/html/search.html#searchType=song&searchKeyWord=${query}` : null;
    }
    case "appleMusic": {
      const id = extra?.id;
      return id ? `https://music.apple.com/song/${id}` : query ? `https://music.apple.com/cn/search?term=${query}` : null;
    }
    case "amll":
      // AMLL 与平台绑定，退回平台搜索
      return null;
    default:
      return null;
  }
};

/**
 * 取在线平台的歌曲合集分享链接
 * @param collection - 当前歌曲合集，本地/流媒体/不支持平台返回 null
 */
export const getCollectionShareUrl = (
  collection: Collection | null | undefined,
): string | null => {
  if (!collection?.id) return null;
  const urls: Record<CollectionType, Record<TrackSource, string | null>> = {
    album: {
      netease: `https://music.163.com/#/album?id=${collection.id}`,
      qqmusic: `https://y.qq.com/n/ryqq_v2/albumDetail/${collection.id}`,
      kugou: `https://www.kugou.com/album/info/${collection.id}/`,
      streaming: null,
      local: null,
    },
    playlist: {
      netease: `https://music.163.com/#/playlist?id=${collection.id}`,
      qqmusic: `https://y.qq.com/n/ryqq_v2/playlist/${collection.id}`,
      kugou: `https://www.kugou.com/songlist/${collection.id}/`,
      streaming: null,
      local: null,
    },
    radio: {
      netease: `https://music.163.com/#/djradio?id=${collection.id}`,
      qqmusic: `https://y.qq.com/n/ryqq_v2/player_radio#id=${collection.id}`,
      kugou: `https://www.kugou.com/song/#fm_id=${collection.id}`,
      streaming: null,
      local: null,
    },
    cloud: {
      netease: null,
      qqmusic: null,
      kugou: null,
      streaming: null,
      local: null,
    },
  };
  return urls[collection.type]?.[collection.source] ?? null;
};
