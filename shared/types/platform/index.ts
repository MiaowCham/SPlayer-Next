/** 平台类型；appleMusic 只用于搜索与试听，目录数据来自 iTunes Search */
export type Platform = "netease" | "qqmusic" | "kugou" | "appleMusic";

/** 平台简写 */
export const PLATFORM_SHORT_NAME: Record<Platform, string> = {
  netease: "NCM",
  qqmusic: "QM",
  kugou: "KG",
  appleMusic: "AM",
};

/** 全部平台 */
export const ALL_PLATFORMS: Platform[] = ["netease", "qqmusic", "kugou"];

/** 搜索页可选的平台；Apple Music 只有单曲搜索 */
export const SEARCH_PLATFORMS: Platform[] = [...ALL_PLATFORMS, "appleMusic"];

const PLATFORM_SET = new Set<string>(ALL_PLATFORMS);

/**
 * 判断来源是否为在线平台并收窄类型
 * @param source - 歌曲来源
 * @returns 是否为支持的在线平台
 */
export const isPlatform = (source: string | undefined): source is Platform =>
  source !== undefined && PLATFORM_SET.has(source);

/** 平台用户账号资料 */
export interface PlatformProfile {
  userId: string;
  nickname: string;
  avatarUrl: string;
  isVip: boolean;
  vipLevel?: number;
}
