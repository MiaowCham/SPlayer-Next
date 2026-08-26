import type { TrackLyricPreference } from "@shared/types/lyrics";
import type { Platform } from "@shared/types/platform";
import type { Track } from "@shared/types/player";
import { toRaw } from "vue";
import { useSettingsStore } from "@/stores/settings";

type PreferenceListener = (
  track: Pick<Track, "source" | "id">,
  value: TrackLyricPreference,
) => void;

const listeners = new Set<PreferenceListener>();

/** 将全局默认值转换为逐曲来源首选项。 */
const globalPreference = (): TrackLyricPreference => {
  const value = useSettingsStore().lyric.lyricSourcePreference;
  if (value === "auto" || value === "self" || value === "local") return { source: value };
  return { source: "platform", platform: value };
};

/**
 * 读取单曲的有效来源首选项。
 * @param track - 目标歌曲
 * @returns 单曲覆盖值；没有覆盖时返回全局默认值
 */
export const getEffectiveTrackLyricPreference = async (
  track: Track,
): Promise<TrackLyricPreference> =>
  (await window.api.lyrics.getTrackPreference(toRaw(track) as Track)) ?? globalPreference();

/** 将用户在歌词管理中填写的搜索词应用到检索曲目。 */
export const applyLyricSearchOverride = (
  track: Track,
  preference: TrackLyricPreference,
): { track: Track; forceQuery: boolean } => {
  const title = preference.search?.title.trim();
  const artist = preference.search?.artist.trim();
  if (!title && !artist) return { track, forceQuery: false };
  return {
    track: {
      ...track,
      title: title || track.title,
      artists: artist ? [{ ...track.artists[0], name: artist }] : track.artists,
    },
    forceQuery: true,
  };
};

/**
 * 写入单曲来源首选项并通知当前渲染进程内的两个选择界面。
 * @param track - 目标歌曲
 * @param value - 新的来源首选项
 */
export const setEffectiveTrackLyricPreference = async (
  track: Track,
  value: TrackLyricPreference,
): Promise<void> => {
  const rawTrack = toRaw(track) as Track;
  const { invalidatePreloadedLyric } = await import("@/services/lyric/preload");
  invalidatePreloadedLyric();
  await window.api.lyrics.setTrackPreference(rawTrack, value);
  for (const listener of listeners) listener(rawTrack, value);
};

/** 订阅同一渲染进程内的来源首选项变化。 */
export const onTrackLyricPreferenceChanged = (listener: PreferenceListener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** 将来源首选项编码为选择组件使用的字符串。 */
export const encodeTrackLyricPreference = (value: TrackLyricPreference): string => {
  if (value.source === "platform") return value.platform;
  if (value.source === "amll") return `amll:${value.platform}`;
  return value.source;
};

/** 将选择组件值解析为来源首选项。 */
export const decodeTrackLyricPreference = (value: string): TrackLyricPreference => {
  if (value === "auto" || value === "self" || value === "local" || value === "localTtml") {
    return { source: value };
  }
  if (value === "amll:netease" || value === "amll:qqmusic") {
    return { source: "amll", platform: value.slice(5) as "netease" | "qqmusic" };
  }
  return { source: "platform", platform: value as Platform };
};
