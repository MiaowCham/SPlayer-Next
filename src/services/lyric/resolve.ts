import type { Track, TrackDetail } from "@shared/types/player";
import type { LyricData, LyricFormat, LyricInput, LyricMatchResult } from "@shared/types/lyrics";
import type { Platform } from "@shared/types/platform";
import { isPlatform } from "@shared/types/platform";
import { detectFormat } from "@/utils/lyric/parse";
import { useSettingsStore } from "@/stores/settings";
import { usePluginsStore } from "@/stores/plugins";
import { DEFAULT_LYRIC_FORMAT_ORDER, DEFAULT_LYRIC_SOURCE_ORDER } from "@/types/settings";
import {
  requestAppleMusicTTML,
  requestPlatformLyric,
  requestStreamingLyric,
  requestTTMLOverlay,
} from "./request";

/** 渲染进程歌词日志：经 IPC 落到主进程文件日志。 */
const logLyric = (level: "info" | "warn" | "error", message: string): void => {
  void window.api.lyrics.log(level, message);
};

/** 支持 AMLL TTML DB 的平台列表 */
const TTML_PLATFORMS = ["netease", "qqmusic"] as const;

/** 单个平台返回的在线歌词 */
export interface OnlineResult {
  source: { source: "online"; format: LyricFormat; platform: Platform };
  input: LyricInput;
}

/** 已解析的歌词候选 */
export interface ResolvedLyric {
  source: NonNullable<LyricData>;
  input: LyricInput;
}

/** 本地歌词读取结果 */
export type LocalLyric = { source: NonNullable<LyricData>; content: string };

/** 读取用户手动管理歌词。 */
export const resolveManagedLyric = async (track: Track): Promise<ResolvedLyric | null> => {
  const lyric = await window.api.lyrics.getManaged(track);
  if (!lyric?.content.trim()) return null;
  return {
    source: { source: "managed", format: lyric.format },
    input: {
      content: lyric.content,
      translation: lyric.translation,
      translationFormat: lyric.translationFormat,
      romaji: lyric.romaji,
      romajiFormat: lyric.romajiFormat,
    },
  };
};

/** 匹配结果转为在线歌词结果 */
const toOnlineResult = (data: LyricMatchResult): OnlineResult => ({
  source: { source: "online", format: data.format, platform: data.platform },
  input: {
    content: data.content,
    translation: data.translation,
    translationFormat: data.translationFormat,
    romaji: data.romaji,
    romajiFormat: data.romajiFormat,
  },
});

/** 请求并转换指定平台歌词 */
const resolvePlatformLyric = async (
  platform: Platform,
  track: Track,
  forceQuery = false,
): Promise<OnlineResult | null> => {
  const result = await requestPlatformLyric(platform, track, forceQuery);
  return result ? toOnlineResult(result) : null;
};

/**
 * 请求并解析流媒体服务端歌词
 * @param track - 歌曲信息
 * @returns 服务端歌词，不存在则返回 null
 */
export const resolveStreamingLyric = async (track: Track): Promise<ResolvedLyric | null> => {
  const text = await requestStreamingLyric(track);
  if (!text?.trim()) return null;
  return { source: { source: "external", format: detectFormat(text) }, input: { content: text } };
};

/** 提取内嵌歌词兜底 */
export const embeddedLyricFromDetail = (detail: TrackDetail | null): LocalLyric | null => {
  if (!detail?.embeddedLyric) return null;
  return {
    source: { source: "embedded", format: detectFormat(detail.embeddedLyric) },
    content: detail.embeddedLyric,
  };
};

/** 平台主格式可达列表 */
const PLATFORM_MAIN_FORMATS: Record<Platform, LyricFormat[]> = {
  netease: ["yrc", "lrc"],
  qqmusic: ["qrc", "lrc"],
  kugou: ["krc", "lrc"],
};

/**
 * 判断在指定平台是否能拿到比本地更优的主格式
 * @param platform - 平台
 * @param localFormat - 本地格式
 * @param formatOrder - 格式优先级
 */
const platformCanUpgrade = (
  platform: Platform,
  localFormat: LyricFormat,
  formatOrder: readonly LyricFormat[],
): boolean => {
  const localIdx = formatOrder.indexOf(localFormat);
  if (localIdx === -1) return true;
  for (const format of PLATFORM_MAIN_FORMATS[platform] ?? []) {
    const idx = formatOrder.indexOf(format);
    if (idx !== -1 && idx < localIdx) return true;
  }
  return false;
};

/** 判断在线结果是否优于本地歌词 */
const isOnlineResultUpgrade = (result: OnlineResult, localFormat: LyricFormat): boolean => {
  const formatOrder = useSettingsStore().lyric.lyricFormatOrder ?? DEFAULT_LYRIC_FORMAT_ORDER;
  const localIdx = formatOrder.indexOf(localFormat);
  if (localIdx === -1) return true;
  const mainIdx = formatOrder.indexOf(result.source.format);
  return mainIdx !== -1 && mainIdx < localIdx;
};

interface OnlinePreferenceOptions {
  hasLocal: boolean;
  localFormat: LyricFormat | null;
  preference?: import("@/types/settings").LyricSourcePreference;
  onCandidate?: (result: OnlineResult) => void;
  shouldContinue?: () => boolean;
  /** 用户已指定搜索条件时，不得以当前平台 ID 绕过该条件。 */
  forceQuery?: boolean;
}

/**
 * 按当前歌词来源偏好获取在线歌词
 * @param track - 歌曲信息
 * @param options - 本地歌词与竞态选项
 */
export const resolveOnlineByPreference = async (
  track: Track,
  options: OnlinePreferenceOptions,
): Promise<OnlineResult | null> => {
  const settings = useSettingsStore();
  let preference = options.preference ?? settings.lyric.lyricSourcePreference;
  const isCurrent = options.shouldContinue ?? (() => true);
  if (preference === "local") {
    if (options.hasLocal) return null;
    preference = "auto";
  }
  if (preference === "self") {
    const result = isPlatform(track.source)
      ? await resolvePlatformLyric(track.source, track, options.forceQuery)
      : null;
    if (result || options.hasLocal) return result;
    preference = "auto";
  }
  if (preference !== "auto") {
    const preferred = await resolvePlatformLyric(preference, track, options.forceQuery);
    if (preferred || options.hasLocal) return preferred;
    preference = "auto";
  }

  const order = settings.lyric.lyricSourceOrder ?? DEFAULT_LYRIC_SOURCE_ORDER;
  const platformOrder = order.filter(isPlatform);
  const formatOrder = settings.lyric.lyricFormatOrder ?? DEFAULT_LYRIC_FORMAT_ORDER;
  let candidates: Platform[] = [...platformOrder];
  if (options.hasLocal) {
    // 开通「自动升级歌词格式」或「优先有翻译」时才需要查询在线候选比较；否则直接用本地歌词。
    if (!settings.lyric.smartPreferOnline && !settings.lyric.preferTranslatedLyrics) return null;
    if (settings.lyric.smartPreferOnline && options.localFormat) {
      candidates = platformOrder.filter((platform) =>
        platformCanUpgrade(platform, options.localFormat!, formatOrder),
      );
      if (candidates.length === 0 && !settings.lyric.preferTranslatedLyrics) return null;
    }
    // 仅「优先有翻译」开启：保持全部平台候选，用于比较是否有翻译。
    if (!settings.lyric.smartPreferOnline) candidates = [...platformOrder];
  }
  logLyric(
    "info",
    `resolveOnlineByPreference: preference=${preference}, smartPreferOnline=${settings.lyric.smartPreferOnline}, candidates=${candidates.join(",")}`,
  );

  // 「优先翻译」需要比较全部候选后再选，与 smartPreferOnline 共用「最佳选择」分支；
  // 否则默认按来源顺序命中即返回，会忽略 preferTranslatedLyrics。
  if (settings.lyric.smartPreferOnline || settings.lyric.preferTranslatedLyrics) {
    let best: OnlineResult | null = null;
    const preferTranslated = settings.lyric.preferTranslatedLyrics;
    const rankOf = (result: OnlineResult): number => {
      const idx = formatOrder.indexOf(result.source.format);
      return idx === -1 ? Infinity : idx;
    };
    // 是否比当前 best 更优：开启「优先有翻译」时先比是否有翻译，再比格式优先级
    const isBetter = (candidate: OnlineResult, current: OnlineResult | null): boolean => {
      if (!current) return true;
      if (preferTranslated) {
        const candidateTrans = !!candidate.input.translation?.trim();
        const currentTrans = !!current.input.translation?.trim();
        if (candidateTrans !== currentTrans) {
          // 有翻译的候选获胜（无论格式优先级如何）
          return candidateTrans;
        }
      }
      return rankOf(candidate) < rankOf(current);
    };
    logLyric(
      "info",
      `resolveOnlineByPreference: preferTranslatedLyrics=${preferTranslated} smartPreferOnline=${settings.lyric.smartPreferOnline}, 候选数=${candidates.length}`,
    );
    await Promise.all(
      candidates.map(async (platform) => {
        const result = await resolvePlatformLyric(platform, track, options.forceQuery);
        if (!isCurrent()) return;
        if (!result) {
          logLyric("info", `  ${platform}: miss`);
          return;
        }
        const hasTrans = !!result.input.translation?.trim();
        logLyric(
          "info",
          `  ${platform}: hit ${result.source.format}${hasTrans ? " (有翻译)" : " (无翻译)"} rank=${rankOf(result)}`,
        );
        if (isBetter(result, best)) {
          const prevTrans = best?.input.translation?.trim();
          logLyric(
            "info",
            `  ${platform}: 选中（${hasTrans ? "有翻译" : "无翻译"}）, 替换 ${best ? `${best.source.platform}:${best.source.format}(${prevTrans ? "有翻译" : "无翻译"})` : "无"}`,
          );
          best = result;
          options.onCandidate?.(result);
        } else if (best) {
          logLyric(
            "info",
            `  ${platform}: 未选中，当前 best=${best.source.platform}:${best.source.format}`,
          );
        }
      }),
    );
    const chosen = best as OnlineResult | null;
    logLyric("info", `  best=${chosen ? `${chosen.source.platform}:${chosen.source.format}${chosen.input.translation?.trim() ? "(有翻译)" : "(无翻译)"}` : "null"}`);
    return isCurrent() ? best : null;
  }

  for (const platform of candidates) {
    const result = await resolvePlatformLyric(platform, track, options.forceQuery);
    if (!isCurrent()) return null;
    if (!result) {
      logLyric("info", `  ${platform}: miss`);
      continue;
    }
    if (
      options.hasLocal &&
      options.localFormat &&
      !isOnlineResultUpgrade(result, options.localFormat)
    ) {
      logLyric("info", `  ${platform}: hit ${result.source.format} 但不优于本地`);
      continue;
    }
    logLyric("info", `  ${platform}: hit ${result.source.format} → 采用`);
    return result;
  }
  return null;
};

/** 判断是否应该尝试 TTML 升级 */
const shouldTryTTMLByFormat = (mainFormat: LyricFormat): boolean => {
  const settings = useSettingsStore();
  if (!settings.system.lyric.enableOnlineTTMLLyric) return false;
  if (!(settings.lyric.lyricSourceOrder ?? DEFAULT_LYRIC_SOURCE_ORDER).includes("amll")) {
    return false;
  }
  if (settings.lyric.lyricSourcePreference === "self") return false;
  const order = settings.lyric.lyricFormatOrder ?? DEFAULT_LYRIC_FORMAT_ORDER;
  const ttmlIdx = order.indexOf("ttml");
  if (ttmlIdx === -1) return false;
  const mainIdx = order.indexOf(mainFormat);
  return mainIdx === -1 || ttmlIdx < mainIdx;
};

/**
 * 拉取在线歌词对应的 TTML 覆盖版本
 * @param track - 歌曲信息
 * @param online - 在线歌词结果
 */
export const resolveTTMLOverlay = async (
  track: Track,
  online: OnlineResult,
  preferredPlatform?: "netease" | "qqmusic",
  forceQuery = false,
): Promise<ResolvedLyric | null> => {
  // 「优先翻译」优先级最高：当前在线歌词已带翻译时，无翻译的 TTML 覆盖一律阻止，
  // 否则会把用户选中的翻译歌词降级成未翻译的 TTML。
  if (useSettingsStore().lyric.preferTranslatedLyrics && online.input.translation?.trim()) {
    return null;
  }
  if (!preferredPlatform && !shouldTryTTMLByFormat(online.source.format)) return null;
  const candidates = await Promise.all(
    TTML_PLATFORMS.filter((platform) => !preferredPlatform || platform === preferredPlatform).map(
      async (platform) => ({
        platform,
        response: await requestTTMLOverlay(track, platform, forceQuery),
      }),
    ),
  );
  const match = candidates.find(
    (candidate): candidate is typeof candidate & { response: { ok: true; data: string } } =>
      candidate.response.ok && !!candidate.response.data,
  );
  if (!match) return null;
  return {
    source: { source: "online", format: "ttml", platform: match.platform, provider: "amll" },
    input: { content: match.response.data },
  };
};

/**
 * 按歌词来源偏好解析流媒体歌词
 * @param track - 流媒体歌曲
 * @param shouldContinue - 竞态检查
 * @returns 最终歌词候选，不存在则返回 null
 */
export const resolveStreamingByPreference = async (
  track: Track,
  shouldContinue: () => boolean = () => true,
  override?: import("@/types/settings").LyricSourcePreference,
): Promise<ResolvedLyric | null> => {
  const preference = override ?? useSettingsStore().lyric.lyricSourcePreference;
  let serverLyric: ResolvedLyric | null = null;

  if (preference === "self" || preference === "auto") {
    serverLyric = await resolveStreamingLyric(track);
    if (!shouldContinue()) return null;
    if (preference === "self") return serverLyric;
  }

  const online = await resolveOnlineByPreference(track, {
    hasLocal: !!serverLyric,
    localFormat: serverLyric?.source.format ?? null,
    preference,
    shouldContinue,
  });
  if (!shouldContinue()) return null;
  if (online) {
    const ttml = await resolveTTMLOverlay(track, online);
    if (!shouldContinue()) return null;
    return ttml ?? { source: online.source, input: online.input };
  }
  if (serverLyric || preference === "auto") return serverLyric;

  return resolveStreamingLyric(track);
};

/**
 * 从本地 TTML 仓库解析歌词
 * @param track - 歌曲信息
 * @returns 本地仓库歌词，不存在则返回 null
 */
export const resolveLocalRepoLyric = async (
  track: Track,
  forceQuery = false,
): Promise<ResolvedLyric | null> => {
  const settings = useSettingsStore();
  if (
    !settings.system.localLyric?.enableLocalTTMLOverride ||
    !settings.system.localLyric?.repoDir
  ) {
    return null;
  }
  const resp = await window.api.lyrics.matchLocalTTML(track, forceQuery);
  if (!resp.ok || !resp.data) return null;
  return {
    source: { source: "external", format: "ttml", provider: "localTtml" },
    input: { content: resp.data },
  };
};

/** 从 Apple Music 获取 TTML；作为内置歌词来源的最后兜底。 */
export const resolveAppleMusicTTML = async (track: Track): Promise<ResolvedLyric | null> => {
  if (!useSettingsStore().system.lyric.enableAppleMusicTTMLLyric) return null;
  const response = await requestAppleMusicTTML(track);
  if (!response.ok || !response.data) return null;
  return {
    source: { source: "online", format: "ttml", provider: "appleMusic" },
    input: { content: response.data },
  };
};

/**
 * 从插件解析歌词
 * @param track - 歌曲信息
 * @returns 首个有效插件歌词，不存在则返回 null
 */
export const resolvePluginLyric = async (track: Track): Promise<ResolvedLyric | null> => {
  const plugins = usePluginsStore();
  for (const info of plugins.list) {
    if (!info.enabled || info.status.state !== "ready") continue;
    for (const [source, cap] of Object.entries(info.status.sources)) {
      if (!cap.actions.includes("musicLyric")) continue;
      const resp = await window.api.plugins.matchLyric({
        pluginId: info.manifest.id,
        source,
        track,
      });
      if (!resp.ok || !resp.data) continue;
      const content = resp.data.awlyric ?? resp.data.lyric;
      if (!content?.trim()) continue;
      return {
        source: { source: "online", format: detectFormat(content) },
        input: { content, translation: resp.data.tlyric, romaji: resp.data.rlyric },
      };
    }
  }
  return null;
};

/**
 * 为下一首歌曲解析最终歌词结果
 * 本地歌曲依赖实际加载后的 TrackDetail，不在此处提前解析
 * @param track - 候选歌曲
 * @returns 最终歌词，不存在或不支持预载则返回 null
 */
export const resolveLyricForPreload = async (
  track: Track,
  shouldContinue: () => boolean,
): Promise<ResolvedLyric | null> => {
  const storedPreference = await window.api.lyrics.getTrackPreference(track);
  if (!shouldContinue()) return null;
  const globalPreference = useSettingsStore().lyric.lyricSourcePreference;
  const preference = storedPreference
    ? storedPreference.source === "platform" || storedPreference.source === "amll"
      ? storedPreference.platform
      : storedPreference.source === "localTtml"
        ? "local"
        : storedPreference.source === "appleMusic"
          ? "auto"
          : storedPreference.source
    : globalPreference;
  const wantsManaged = storedPreference
    ? storedPreference.source === "auto" || storedPreference.source === "local"
    : preference === "auto" || preference === "local";
  const wantsLocalRepo = storedPreference
    ? storedPreference.source === "auto" ||
      storedPreference.source === "local" ||
      storedPreference.source === "localTtml"
    : preference === "auto" || preference === "local";
  if (wantsManaged) {
    const managed = await resolveManagedLyric(track);
    if (!shouldContinue()) return null;
    if (managed) return managed;
  }
  if (track.source === "local") return null;

  if (wantsLocalRepo) {
    const localRepo = await resolveLocalRepoLyric(track);
    if (!shouldContinue()) return null;
    if (localRepo) return localRepo;
  }

  if (track.source === "streaming") {
    const streaming = await resolveStreamingByPreference(track, shouldContinue, preference);
    if (!shouldContinue()) return null;
    if (streaming) return streaming;
    // Apple Music 搜索可能较慢，不阻塞下一首预载；当前歌曲加载时会异步升级。
    const plugin = await resolvePluginLyric(track);
    return shouldContinue() ? plugin : null;
  }

  const online = await resolveOnlineByPreference(track, {
    hasLocal: false,
    localFormat: null,
    preference,
    shouldContinue,
  });
  if (!shouldContinue()) return null;
  if (online) {
    const ttml =
      storedPreference?.source === "platform"
        ? null
        : await resolveTTMLOverlay(
            track,
            online,
            storedPreference?.source === "amll" ? storedPreference.platform : undefined,
          );
    if (!shouldContinue()) return null;
    return ttml ?? { source: online.source, input: online.input };
  }

  // Apple Music 搜索由当前歌曲加载器异步执行，避免预载阶段阻塞首屏歌词。
  const plugin = await resolvePluginLyric(track);
  return shouldContinue() ? plugin : null;
};
