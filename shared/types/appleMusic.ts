/** Apple Music 搜索分类 */
export type AppleMusicSearchKind = "songs" | "albums" | "artists";

/** Apple Music 搜索入参 */
export interface AppleMusicSearchParams {
  /** 搜索分类 */
  kind: AppleMusicSearchKind;
  /** 关键词 */
  keyword: string;
  /** 商店地区（两位国家码，如 us / jp / cn / tw / hk） */
  storefront: string;
  /** 偏移量 */
  offset: number;
  /** 单页数量 */
  limit: number;
}

/** Apple Music 曲目 */
export interface AppleMusicSong {
  id: string;
  title: string;
  artistName: string;
  artistId?: string;
  albumName: string;
  albumId?: string;
  /** 时长（毫秒） */
  durationMs: number;
  coverUrl?: string;
  /** 30 秒试听地址；部分曲目没有 */
  previewUrl?: string;
}

/** Apple Music 专辑 */
export interface AppleMusicAlbum {
  id: string;
  title: string;
  artistName: string;
  coverUrl?: string;
  trackCount?: number;
}

/** Apple Music 歌手 */
export interface AppleMusicArtist {
  id: string;
  name: string;
  coverUrl?: string;
}

/** Apple Music 搜索结果；iTunes Search 不返回总数，hasMore 由是否取满一页推断 */
export interface AppleMusicSearchResult {
  songs?: AppleMusicSong[];
  albums?: AppleMusicAlbum[];
  artists?: AppleMusicArtist[];
  hasMore: boolean;
}

/** 渲染层可用的 Apple Music API */
/** Apple Music 动态封面查询入参 */
export interface AppleMusicMotionParams {
  /** 歌曲标题 */
  title: string;
  /** 歌手名 */
  artist: string;
  /** 专辑名，用于在多个候选专辑中挑选匹配项 */
  album?: string;
  /** 已知的 Apple Music 曲目 ID（Apple Music 来源时可直接定位） */
  songId?: string;
  /** 商店地区（两位国家码） */
  storefront: string;
}

/** Apple Music 动态封面结果 */
export interface AppleMusicMotionResult {
  /** 动态封面视频地址（HLS 播放列表） */
  url: string;
  /** 候选专辑的静态封面地址，用于与曲目封面做指纹比对 */
  artwork: string | null;
  /** 专辑名是否精确命中（精确命中时指纹仅作参考） */
  exact: boolean;
}

export interface AppleMusicApi {
  /**
   * 按分类搜索 Apple Music 目录
   * @param params - 搜索入参
   * @returns 归一化后的搜索结果
   */
  search: (params: AppleMusicSearchParams) => Promise<AppleMusicSearchResult>;
  /**
   * 查询专辑动态封面（editorialVideo）
   * @param params - 曲目元信息与商店地区
   * @returns 命中返回 HLS 地址，未命中返回 null
   */
  motion: (params: AppleMusicMotionParams) => Promise<AppleMusicMotionResult | null>;
  /**
   * 使指定曲目的动态封面缓存失效
   *
   * 视频加载失败（节日限定封面已撤下）时调用，下次播放重新向 Apple 查询
   *
   * @param params - 曲目元信息与商店地区
   */
  motionInvalidate: (params: AppleMusicMotionParams) => void;
}
