/**
 * 当前歌曲歌词加载服务
 */

import type { Track, TrackDetail } from "@shared/types/player";
import type { LyricData, LyricInput, TrackLyricPreference } from "@shared/types/lyrics";
import { isPlatform } from "@shared/types/platform";
import { bestExternalIndex, detectFormat } from "@/utils/lyric/parse";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { DEFAULT_LYRIC_FORMAT_ORDER, DEFAULT_LYRIC_SOURCE_ORDER } from "@/types/settings";
import {
  embeddedLyricFromDetail,
  isBetterFormat,
  isPluginLyricPreferred,
  resolveAppleMusicTTML,
  resolveManagedLyric,
  resolveLocalRepoLyric,
  resolveOnlineByPreference,
  resolvePluginLyric,
  resolveStreamingByPreference,
  resolveTTMLOverlay,
  type LocalLyric,
  type OnlineResult,
  type ResolvedLyric,
} from "@/services/lyric/resolve";
import { consumePreloadedLyric } from "@/services/lyric/preload";
import {
  applyLyricSearchOverride,
  getEffectiveTrackLyricPreference,
} from "@/services/lyric/preference";
import { requestCachedAppleMusicTTML } from "@/services/lyric/request";
import type { LyricSourcePreference } from "@/types/settings";

/** 竞态 token */
let currentToken = 0;

/** 渲染进程歌词日志：经 IPC 落到主进程文件日志，便于定位歌词加载链路。 */
const logLyric = (level: "info" | "warn" | "error", message: string): void => {
  void window.api.lyrics.log(level, message);
};

/** 用简短字符串描述当前已提交歌词，便于日志追踪。 */
const describeActive = (): string => {
  const media = useMediaStore();
  const lyric = media.activeLyric;
  if (!lyric) return "null";
  return [
    lyric.source,
    lyric.format,
    lyric.platform ?? lyric.provider ?? "",
    `lines=${media.parsedLyric.length}`,
  ]
    .filter(Boolean)
    .join(":");
};

/** 将逐曲来源首选项映射到现有在线解析器支持的基础偏好。 */
const basePreference = (choice: TrackLyricPreference): LyricSourcePreference => {
  if (choice.source === "platform" || choice.source === "amll") return choice.platform;
  if (choice.source === "localTtml") return "local";
  if (choice.source === "appleMusic") return "auto";
  return choice.source;
};

/**
 * 读取本地歌词
 * @param detail - 歌曲详细信息
 */
const readLocal = async (
  detail: TrackDetail,
): Promise<{ source: NonNullable<LyricData>; content: string } | null> => {
  const order = useSettingsStore().lyric.lyricFormatOrder ?? DEFAULT_LYRIC_FORMAT_ORDER;
  const idx = bestExternalIndex(detail.externalLyrics, order);
  if (idx !== -1) {
    const ext = detail.externalLyrics[idx];
    const result = await window.api.player.readLyricFile(ext.path);
    if (!result.success || result.data == null) return null;
    const format = ext.format === "ttml" ? detectFormat(result.data) : ext.format;
    return { source: { source: "external", format }, content: result.data };
  }
  return embeddedLyricFromDetail(detail);
};

/**
 * 提交歌词
 * @param token - 竞态 token
 * @param source - 歌词源
 * @param input - 歌词内容
 */
const commit = (token: number, source: LyricData, input: LyricInput | null): void => {
  if (token !== currentToken) return;
  useMediaStore().setLyric(source, input);
  const media = useMediaStore();
  const desc = source
    ? `${source.source}:${source.format}:${source.platform ?? source.provider ?? ""}`
    : "null";
  logLyric(
    "info",
    `commit → ${desc}, parsedLines=${media.parsedLyric.length}, token=${token}`,
  );
};

/** 提交本地歌词 */
const commitLocal = (token: number, local: LocalLyric): void => {
  commit(token, local.source, { content: local.content });
};

/**
 * 提交歌词并返回解析是否有效
 * @param token - 竞态 token
 * @param source - 歌词源
 * @param input - 歌词内容
 */
const commitAndHasParsed = (
  token: number,
  source: NonNullable<LyricData>,
  input: LyricInput,
): boolean => {
  commit(token, source, input);
  if (token !== currentToken) return false;
  return useMediaStore().parsedLyric.length > 0;
};

/** 提交已解析歌词候选并返回是否有效 */
const commitResolvedAndHasParsed = (token: number, resolved: ResolvedLyric): boolean =>
  commitAndHasParsed(token, resolved.source, resolved.input);

/**
 * 提交在线歌词；解析后为空时优先回退本地，本地也无再按需 TTML 升级
 */
const applyOnline = async (
  token: number,
  track: Track,
  online: OnlineResult,
  fallbackLocal: LocalLyric | null,
  ttmlPreference?: "netease" | "qqmusic" | false,
  forceQuery = false,
): Promise<void> => {
  const media = useMediaStore();
  const current = media.activeLyric;
  // 跳过同源同格式
  const alreadyCommitted =
    current?.source === "online" &&
    current.platform === online.source.platform &&
    current.format === online.source.format;
  if (!alreadyCommitted) {
    if (!commitAndHasParsed(token, online.source, online.input) && fallbackLocal) {
      commitLocal(token, fallbackLocal);
      return;
    }
    if (token !== currentToken) return;
  } else if (media.parsedLyric.length === 0 && fallbackLocal) {
    commitLocal(token, fallbackLocal);
    return;
  }
  if (ttmlPreference === false) return;
  const ttml = await resolveTTMLOverlay(track, online, ttmlPreference, forceQuery);
  if (token !== currentToken) return;
  if (ttml) {
    // TTML 覆盖也必须解析出有效行，否则保留当前在线歌词，避免被无效 TTML 清成 NO-LRC
    if (!commitResolvedAndHasParsed(token, ttml)) {
      commit(token, online.source, online.input);
      logLyric("warn", "applyOnline: TTML 覆盖解析为空，回退到在线歌词");
    }
  }
};

/**
 * 本地 TTML 歌词库匹配：命中即以最高优先级提交，调用方据此跳过在线请求
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @returns 是否命中
 */
const tryLocalRepo = async (
  token: number,
  track: Track,
  choice: TrackLyricPreference,
  allowFallback = false,
  forceQuery = false,
): Promise<boolean> => {
  if (choice.source !== "auto" && choice.source !== "local" && choice.source !== "localTtml") {
    return false;
  }
  const order = useSettingsStore().lyric.lyricSourceOrder ?? DEFAULT_LYRIC_SOURCE_ORDER;
  const repoIndex = order.indexOf("localTtml");
  const firstOnlineIndex = order.findIndex(isPlatform);
  if (
    !allowFallback &&
    choice.source === "auto" &&
    (repoIndex === -1 || (firstOnlineIndex !== -1 && repoIndex > firstOnlineIndex))
  ) {
    return false;
  }
  const resolved = await resolveLocalRepoLyric(track, forceQuery);
  if (token !== currentToken) return false;
  return resolved ? commitResolvedAndHasParsed(token, resolved) : false;
};

/** 手动管理歌词最高优先级。 */
const tryManaged = async (
  token: number,
  track: Track,
  choice: TrackLyricPreference,
): Promise<boolean> => {
  if (choice.source !== "auto" && choice.source !== "local") return false;
  const resolved = await resolveManagedLyric(track);
  if (token !== currentToken) return false;
  return resolved ? commitResolvedAndHasParsed(token, resolved) : false;
};

/**
 * 插件兜底匹配歌词：内置平台都没歌词时，向声明 musicLyric 的插件源逐个兜底
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @returns 是否已提交有效歌词
 */
const tryPluginFallback = async (token: number, track: Track): Promise<boolean> => {
  // 插件优选时不处理
  if (isPluginLyricPreferred()) return false;
  const resolved = await resolvePluginLyric(track);
  if (token !== currentToken) return false;
  return resolved ? commitResolvedAndHasParsed(token, resolved) : false;
};

/** 判断异步 Apple Music 结果是否能够按来源和格式优先级升级当前歌词。 */
const shouldReplaceWithAppleMusic = (current: LyricData): boolean => {
  if (!current) return true;
  if (current.source !== "online") return false;
  const settings = useSettingsStore();
  const formatOrder = settings.lyric.lyricFormatOrder ?? DEFAULT_LYRIC_FORMAT_ORDER;
  const currentFormat = formatOrder.indexOf(current.format);
  const appleFormat = formatOrder.indexOf("ttml");
  if (currentFormat === -1 || (appleFormat !== -1 && appleFormat < currentFormat)) return true;
  if (appleFormat !== currentFormat) return false;
  const order = settings.lyric.lyricSourceOrder ?? DEFAULT_LYRIC_SOURCE_ORDER;
  const appleIndex = order.indexOf("appleMusic");
  if (appleIndex === -1) return false;
  const currentSource = current.provider ?? current.platform;
  const currentIndex = order.indexOf(currentSource as (typeof order)[number]);
  return currentIndex === -1 || appleIndex < currentIndex;
};

/** 异步搜索 Apple Music；先显示已命中的歌词，再按优先级热替换。 */
const scheduleAppleMusicUpgrade = (token: number, track: Track, force = false): void => {
  void resolveAppleMusicTTML(track)
    .then((resolved) => {
      if (token !== currentToken) return;
      if (!resolved) {
        logLyric("info", `AM 升级无结果: ${track.title}`);
        return;
      }
      const media = useMediaStore();
      const replace = force || shouldReplaceWithAppleMusic(media.activeLyric);
      logLyric(
        "info",
        `AM 升级: current=${describeActive()}, force=${force}, replace=${replace}`,
      );
      if (replace) {
        // 先记录当前有效歌词，避免无效 AM 结果把已有歌词清成 NO-LRC
        const previous =
          media.activeLyric && media.lyricContent
            ? { source: media.activeLyric, input: media.lyricContent }
            : null;
        if (!commitResolvedAndHasParsed(token, resolved) && previous && token === currentToken) {
          commit(token, previous.source, previous.input);
          logLyric("info", "AM 提交后解析为空，已回退到上一有效歌词");
        }
      }
    })
    .catch((err) => {
      logLyric(
        "error",
        `AM 升级异常: ${track.title} ${err instanceof Error ? err.message : String(err)}`,
      );
    });
};

/** 缓存命中不触网，按来源优先级立即采用 Apple Music 歌词。 */
const tryCachedAppleMusic = async (token: number, track: Track): Promise<boolean> => {
  let response: { ok: boolean; data?: string | null };
  try {
    response = await requestCachedAppleMusicTTML(track);
  } catch (err) {
    logLyric(
      "error",
      `tryCachedAppleMusic IPC 异常: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
  if (token !== currentToken || !response.ok || !response.data) return false;
  return commitAndHasParsed(
    token,
    { source: "online", format: "ttml", provider: "appleMusic" },
    {
      content: response.data,
    },
  );
};

/** 判断 Apple Music 是否是自动来源排序中的首个可检索来源。 */
const isAppleMusicFirst = (choice: TrackLyricPreference): boolean => {
  if (choice.source === "appleMusic") return true;
  if (choice.source !== "auto") return false;
  const order = useSettingsStore().lyric.lyricSourceOrder ?? DEFAULT_LYRIC_SOURCE_ORDER;
  return order.indexOf("appleMusic") === 0;
};

/**
 * 插件优先加载
 * 插件请求与正常流程并发发出，正常流程先展示，插件返回更优格式时替换
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @param run - 正常加载流程
 */
const withPluginPrefer = async (
  token: number,
  track: Track,
  run: () => Promise<void>,
): Promise<void> => {
  if (!isPluginLyricPreferred()) {
    await run();
    return;
  }
  const pluginTask = resolvePluginLyric(track);
  await run();
  const plugin = await pluginTask;
  if (!plugin || token !== currentToken) return;
  const currentFormat = useMediaStore().activeLyric?.format ?? null;
  if (isBetterFormat(plugin.source.format, currentFormat)) {
    commitResolvedAndHasParsed(token, plugin);
  }
};

/**
 * 流媒体歌词加载：按来源偏好解析，失败后使用插件和内嵌歌词兜底
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @param detail - 歌曲详细信息
 */
const loadStreamingLyric = (
  token: number,
  track: Track,
  detail: TrackDetail | null,
  choice: TrackLyricPreference,
): Promise<void> =>
  withPluginPrefer(token, track, async () => {
    const resolved = await resolveStreamingByPreference(
      track,
      () => token === currentToken,
      basePreference(choice),
    );
    if (token !== currentToken) return;
    const embeddedFallback = embeddedLyricFromDetail(detail);
    if (resolved && commitResolvedAndHasParsed(token, resolved)) return;
    if (token !== currentToken) return;
    if (await tryPluginFallback(token, track)) return;
    if (embeddedFallback) {
      commit(token, embeddedFallback.source, { content: embeddedFallback.content });
    } else {
      commit(token, null, null);
    }
  });

/**
 * 在线平台歌曲歌词加载
 * @param token - 竞态 token
 * @param track - 歌曲信息
 */
const loadPlatformLyric = (
  token: number,
  track: Track,
  choice: TrackLyricPreference,
  forceQuery: boolean,
): Promise<void> =>
  withPluginPrefer(token, track, async () => {
    const online = await resolveOnlineByPreference(track, {
      hasLocal: false,
      localFormat: null,
      preference: basePreference(choice),
      shouldContinue: () => token === currentToken,
      forceQuery,
    });
    if (token !== currentToken) return;
    if (online) {
      logLyric(
        "info",
        `loadPlatformLyric: online=${online.source.platform}:${online.source.format}`,
      );
      await applyOnline(
        token,
        track,
        online,
        null,
        choice.source === "platform" ? false : choice.source === "amll" ? choice.platform : undefined,
        forceQuery,
      );
    } else if (
      !(await tryLocalRepo(token, track, choice, true, forceQuery)) &&
      !(await tryPluginFallback(token, track))
    ) {
      logLyric("warn", `loadPlatformLyric: 无在线/本地/插件歌词 → commit null`);
      commit(token, null, null);
    }
  });

/** 开启新一轮加载周期 */
export const beginLoad = (): number => {
  currentToken++;
  useMediaStore().resetLyricState();
  return currentToken;
};

/**
 * 为当前 track 加载歌词
 *
 * 1. 无 track：commit null 收尾
 * 2. 在线歌曲：
 *    - 默认顺序下，track.platform 与候选平台一致时走 matchById
 *    - 不一致则走 matchByQuery
 * 3. 本地歌曲：本地有先立即 commit 显示；再按偏好查在线，命中热替换
 * 4. 本地 + 在线都无：commit null 收尾 loading
 *
 * @param detail - 歌曲详细信息
 */
export const loadForTrack = async (detail: TrackDetail | null): Promise<void> => {
  const token = beginLoad();
  try {
    const media = useMediaStore();
    const track = media.track;
    // 无 track
    if (!track) {
      commit(token, null, null);
      return;
    }
    const choice = await getEffectiveTrackLyricPreference(track);
    if (token !== currentToken) return;
    const search = applyLyricSearchOverride(track, choice);
    const searchTrack = search.track;
    logLyric(
      "info",
      `loadForTrack: ${track.source}:${track.id} "${track.title}" choice=${choice.source}, trackSource=${track.source}, forceQuery=${search.forceQuery}`,
    );
    if (!search.forceQuery) {
      const preloaded = await consumePreloadedLyric(track);
      if (token !== currentToken) return;
      if (preloaded.hit) {
        if (commitResolvedAndHasParsed(token, preloaded.lyric)) return;
      }
    }
    if (await tryManaged(token, track, choice)) return;
    if (token !== currentToken) return;
    if (choice.source === "appleMusic") {
      if (await tryCachedAppleMusic(token, searchTrack)) return;
      // 手动锁定来源时，不得按照自动排序回退到其他来源。
      scheduleAppleMusicUpgrade(token, searchTrack, true);
      return;
    }
    if (choice.source === "auto") {
      if (isAppleMusicFirst(choice) && (await tryCachedAppleMusic(token, searchTrack))) return;
      scheduleAppleMusicUpgrade(token, searchTrack);
    }
    // 本地 TTML 歌词库最高优先
    if (await tryLocalRepo(token, searchTrack, choice, false, search.forceQuery)) return;
    if (token !== currentToken) return;
    // 在线歌曲（任一在线平台）
    if (isPlatform(track.source)) {
      await loadPlatformLyric(token, searchTrack, choice, search.forceQuery);
      return;
    }
    // 流媒体服务器
    if (track.source === "streaming") {
      await loadStreamingLyric(token, searchTrack, detail, choice);
      return;
    }
    // 本地文件
    const local = detail ? await readLocal(detail) : null;
    if (token !== currentToken) return;
    // 本地立即显示
    if (local) commitLocal(token, local);
    // 本地文件存在但解析后空
    const hasUsableLocal = !!local && media.parsedLyric.length > 0;
    const localFormat = local?.source.format ?? null;
    await withPluginPrefer(token, track, async () => {
      // 按偏好获取歌词
      const online = await resolveOnlineByPreference(searchTrack, {
        hasLocal: hasUsableLocal,
        localFormat,
        preference: basePreference(choice),
        onCandidate: (result) => commit(token, result.source, result.input),
        shouldContinue: () => token === currentToken,
        forceQuery: search.forceQuery,
      });
      if (token !== currentToken) return;
      // id 回查本地 TTML 库
      if (online && (await tryLocalRepo(token, searchTrack, choice, false, search.forceQuery)))
        return;
      if (online) {
        await applyOnline(
          token,
          searchTrack,
          online,
          local,
          choice.source === "platform"
            ? false
            : choice.source === "amll"
              ? choice.platform
              : undefined,
          search.forceQuery,
        );
      } else if (!hasUsableLocal) {
        if (!(await tryPluginFallback(token, track))) {
          commit(token, null, null);
        }
      }
    });
  } catch (err) {
    const failedTrack = useMediaStore().track;
    logLyric(
      "error",
      `loadForTrack 异常: ${failedTrack?.title ?? "?"} ${err instanceof Error ? err.message : String(err)}`,
    );
    console.error("[lyricLoader] loadForTrack failed:", err);
    commit(token, null, null);
  }
};

/** 偏好变化时的刷新 */
const refreshPreference = async (): Promise<void> => {
  currentToken++;
  const token = currentToken;
  const media = useMediaStore();
  const track = media.track;
  if (!track) return;
  const choice = await getEffectiveTrackLyricPreference(track);
  if (token !== currentToken) return;
  const search = applyLyricSearchOverride(track, choice);
  const searchTrack = search.track;
  if (await tryManaged(token, track, choice)) return;
  if (token !== currentToken) return;
  if (choice.source === "appleMusic") {
    if (await tryCachedAppleMusic(token, searchTrack)) return;
    // 刷新时也保持显式来源锁定，等待 Apple Music 检索结果。
    scheduleAppleMusicUpgrade(token, searchTrack, true);
    return;
  }
  if (choice.source === "auto") {
    if (isAppleMusicFirst(choice) && (await tryCachedAppleMusic(token, searchTrack))) return;
    scheduleAppleMusicUpgrade(token, searchTrack);
  }
  // 本地 TTML 歌词库最高优先
  if (await tryLocalRepo(token, searchTrack, choice, false, search.forceQuery)) return;
  if (token !== currentToken) return;
  if (track.source === "streaming") {
    await loadStreamingLyric(token, searchTrack, media.detail, choice);
    return;
  }
  // 在线歌曲（任一在线平台）
  if (isPlatform(track.source)) {
    await loadPlatformLyric(token, searchTrack, choice, search.forceQuery);
    return;
  }
  // 本地歌曲
  const detail = media.detail;
  const local = detail ? await readLocal(detail) : null;
  if (token !== currentToken) return;
  const localFormat = local?.source.format ?? null;
  const showingOnline = media.activeLyric?.source === "online";
  await withPluginPrefer(token, track, async () => {
    /** 按偏好获取歌词 */
    const online = await resolveOnlineByPreference(searchTrack, {
      hasLocal: !!local,
      localFormat,
      preference: basePreference(choice),
      onCandidate: (result) => commit(token, result.source, result.input),
      shouldContinue: () => token === currentToken,
      forceQuery: search.forceQuery,
    });
    if (token !== currentToken) return;
    if (online) {
      await applyOnline(
        token,
        searchTrack,
        online,
        local,
        choice.source === "platform" ? false : choice.source === "amll" ? choice.platform : undefined,
        search.forceQuery,
      );
      return;
    }
    // 目标是本地
    if (!showingOnline) return;
    if (local) commitLocal(token, local);
    else commit(token, null, null);
  });
};

/** 监听歌词偏好变化 */
export const watchLyricPreference = (): void => {
  const settings = useSettingsStore();
  watch(
    () => [
      settings.locale,
      settings.lyric.lyricSourcePreference,
      settings.lyric.smartPreferOnline,
      settings.lyric.preferPluginLyric,
      settings.lyric.detectBackgroundLyrics,
      settings.lyric.fallbackTranslation,
      settings.system.lyric.enableOnlineTTMLLyric,
      settings.system.lyric.enableAppleMusicTTMLLyric,
      settings.system.lyric.appleMusicStorefront,
      settings.system.lyric.appleMusicSearchRegions,
      settings.system.lyric.appleMusicTranslationLanguage,
      settings.system.lyric.appleMusicTranslationScript,
      settings.system.localLyric.enableLocalTTMLOverride,
      settings.system.localLyric.repoDir,
    ],
    () => {
      refreshPreference();
    },
  );
  window.api.lyrics.onManagedChanged((change) => {
    const track = useMediaStore().track;
    if (track && (!change || (track.source === change.source && track.id === change.id))) {
      void loadForTrack(useMediaStore().detail);
    }
  });
};
