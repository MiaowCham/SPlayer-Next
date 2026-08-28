import type { MediaInfo, PlaybackContext, Track, TrackDetail } from "@shared/types/player";
import type { LyricData, LyricFormat, LyricInput, LyricLine } from "@shared/types/lyrics";
import { isPlatform } from "@shared/types/platform";
import { findLyricIndex } from "@shared/utils/lyric";
import { useSettingsStore } from "@/stores/settings";
import { watchLyricPreference } from "@/services/lyric/loader";
import { parseLyric } from "@/utils/lyric/parse";
import { applyLyricLanguages } from "@/utils/lyric/language";
import {
  extractLyricAuthorInfo,
  extractNeteaseCreators,
  type LyricAuthorKind,
} from "@/utils/lyric/author";
import { neteaseCall } from "@/apis/netease";
import { useUserStore } from "@/stores/user";
import { applyLyricExclude } from "@/utils/lyric/lyricStripper";
import { normalizeLyricLines } from "@/utils/lyric/normalize";
import { applyProfanityUncensor } from "@/utils/preset/profanity";
import { getValidArtists } from "@shared/utils/track";
import { applyLyricCjkTransform } from "@/utils/lyric/cjkTransform";

export const useMediaStore = defineStore("media", () => {
  watchLyricPreference();

  /** 当前歌曲轻量信息 */
  const track = shallowRef<Track | null>(null);

  /** 当前播放的来源上下文 */
  const playbackContext = shallowRef<PlaybackContext>();

  /** 当前歌曲详细信息 */
  const detail = shallowRef<TrackDetail | null>(null);

  /** 当前选中的歌词数据 */
  const activeLyric = ref<LyricData>(null);

  /** 当前歌词原始内容 */
  const lyricContent = ref<LyricInput | null>(null);

  /** 歌词是否正在加载 */
  const lyricLoading = ref(false);

  /** 当前歌词行索引，-1 表示无匹配 */
  const lyricIndex = ref(-1);

  /** 当前歌词格式 */
  const lyricFormat = computed((): LyricFormat | null => activeLyric.value?.format ?? null);

  /** 当前歌词解析结果 */
  const parsedLyric = shallowRef<LyricLine[]>([]);

  /** 当前歌词文件制作者列表 */
  const lyricAuthors = ref<string[]>([]);
  const lyricAuthorKind = ref<LyricAuthorKind | null>(null);
  const onlineCreators = ref<string[] | null>(null);
  let creatorToken = 0;
  let creatorRequestKey = "";

  /**
   * 刷新当前网易云歌曲的创作者信息
   * @param currentTrack - 发起请求时的歌曲，用于避免切歌后的旧响应覆盖
   */
  const refreshOnlineCreators = async (currentTrack: Track | null): Promise<void> => {
    if (!currentTrack || currentTrack.source !== "netease") return;
    const user = useUserStore();
    if (!user.isLoggedIn) return;
    const requestKey = `${currentTrack.source}:${currentTrack.id}`;
    if (creatorRequestKey === requestKey) return;
    const token = ++creatorToken;
    creatorRequestKey = requestKey;
    try {
      const body = await neteaseCall(
        "ugc_song_get",
        { id: currentTrack.id },
        {
          notifyAuthFailure: false,
        },
      );
      if (
        token !== creatorToken ||
        track.value?.source !== currentTrack.source ||
        track.value.id !== currentTrack.id
      ) {
        return;
      }
      const creators = extractNeteaseCreators(body);
      if (creators.length > 0) {
        onlineCreators.value = creators;
        lyricAuthors.value = creators;
        lyricAuthorKind.value = "creator";
      }
    } catch {
      // 在线创作者信息仅用于补充展示，请求失败时保留歌词文件作者。
    } finally {
      if (token === creatorToken) creatorRequestKey = "";
    }
  };

  /** 同步当前歌词源到主进程 */
  const syncToMain = (): void => {
    try {
      const payload = {
        track: track.value ? toRaw(track.value) : null,
        lyric: toRaw(parsedLyric.value),
        source: activeLyric.value ? toRaw(activeLyric.value) : null,
      };
      window.api.nowPlaying.update(payload);
    } catch (error) {
      console.error("[media] syncToMain failed", error);
    }
  };

  /**
   * 更新 track
   * @param newTrack - 新的歌曲信息
   * @param newDetail - 新的歌曲详细信息；省略则保留现有 detail
   */
  const setTrack = (newTrack: Track, newDetail?: TrackDetail): void => {
    creatorToken++;
    creatorRequestKey = "";
    track.value = newTrack;
    lyricAuthors.value = [];
    lyricAuthorKind.value = null;
    onlineCreators.value = null;
    void refreshOnlineCreators(newTrack);
    if (newDetail) detail.value = newDetail;
  };

  /**
   * 更新当前播放的来源上下文
   * @param context - 播放来源上下文
   */
  const setPlaybackContext = (context?: PlaybackContext): void => {
    playbackContext.value = context;
  };

  /**
   * 把 audio-engine 解析出的元数据合并到当前 Track 上。
   * 保留身份字段（id/source/serverId/originalId/platform/path）；
   * 对未设置/空值的展示字段做兜底填充（duration/quality）。
   * streaming 源的 cover/title/artist/album 已经是服务器返回的权威值，绝不被引擎覆盖。
   */
  const enrichTrack = (info: MediaInfo, newDetail?: TrackDetail): void => {
    if (!track.value) return;
    const isStreaming = track.value.source === "streaming";
    track.value = {
      ...track.value,
      duration: track.value.duration > 0 ? track.value.duration : info.duration,
      cover: isStreaming ? track.value.cover : (track.value.cover ?? info.cover),
      quality: track.value.quality ?? info.quality,
    };
    if (newDetail) detail.value = newDetail;
  };

  /**
   * 兜底封面：当前 track 无封面时把插件命中的远端 URL 填进去
   * 同时写 cover 与 coverOriginal，使全屏大图与背景/取色一并补上；已有封面不覆盖
   * @param url - 封面图片 URL
   */
  const patchCover = (url: string): void => {
    if (!track.value) return;
    if (track.value.cover && track.value.coverOriginal) return;
    track.value = {
      ...track.value,
      cover: track.value.cover || url,
      coverOriginal: track.value.coverOriginal || url,
    };
  };

  /** 重置歌词状态 */
  const resetLyricState = (): void => {
    activeLyric.value = null;
    lyricContent.value = null;
    parsedLyric.value = [];
    lyricAuthors.value = onlineCreators.value ?? [];
    lyricAuthorKind.value = onlineCreators.value ? "creator" : null;
    if (!onlineCreators.value) void refreshOnlineCreators(track.value);
    lyricIndex.value = -1;
    lyricLoading.value = true;
    syncToMain();
  };

  /** 简繁转换竞态 token */
  let transformToken = 0;

  // 监听中文繁简偏好及强迫症设置变化并重新解析当前歌词
  watch(
    () => [
      useSettingsStore().lyric.chineseScriptPreference,
      useSettingsStore().preset.uncensorProfanity,
    ],
    () => {
      if (activeLyric.value && lyricContent.value) {
        setLyric(activeLyric.value, lyricContent.value);
      }
    },
  );

  /**
   * 原子写入歌词
   * @param source - 歌词源
   * @param input - 主歌词 + 可选翻译 / 音译；传 null 即清空
   */
  const setLyric = (source: LyricData, input: LyricInput | null): void => {
    const currentTransformToken = ++transformToken;
    let nextLines: LyricLine[] = [];
    const settings = useSettingsStore();
    if (source && input) {
      try {
        // 临时性能日志：歌词解析耗时（定位后可删除）
        const perfStart = performance.now();
        const lines = parseLyric(input, source.format, settings.locale, {
          detectBackground: settings.lyric.detectBackgroundLyrics,
          fallbackTranslation: settings.lyric.fallbackTranslation,
          normalizeNonStandardHan: settings.lyric.normalizeNonStandardHan,
          platform:
            source.platform ?? (isPlatform(track.value?.source) ? track.value.source : undefined),
        });
        const parseMs = performance.now() - perfStart;
        if (parseMs > 3) {
          console.warn(`[AMLL-perf] parseLyric ${input.content?.length ?? 0} chars (${source.format}) took ${parseMs.toFixed(2)}ms`);
        }
        nextLines = applyLyricExclude(lines, track.value);
        normalizeLyricLines(nextLines);
        // Fuck Mode
        if (settings.preset.uncensorProfanity) {
          applyProfanityUncensor(nextLines);
        }
        applyLyricLanguages(nextLines);
      } catch (e) {
        console.error("[media] parse lyric failed:", e);
        nextLines = [];
      }
    }
    // 解析后无有效行视作无歌词
    const hasContent = nextLines.length > 0;
    activeLyric.value = hasContent ? source : null;
    lyricContent.value = hasContent ? input : null;
    parsedLyric.value = nextLines;
    if (onlineCreators.value) {
      lyricAuthors.value = onlineCreators.value;
      lyricAuthorKind.value = "creator";
    } else if (hasContent && source && input) {
      const authorInfo = extractLyricAuthorInfo(input.content, source.format);
      if (authorInfo.authors.length > 0) {
        lyricAuthors.value = authorInfo.authors;
        lyricAuthorKind.value = authorInfo.kind;
      } else {
        lyricAuthors.value = getValidArtists(track.value?.artists).map((artist) =>
          artist.name.trim(),
        );
        lyricAuthorKind.value = lyricAuthors.value.length > 0 ? "song-production" : null;
      }
    } else {
      lyricAuthors.value = [];
      lyricAuthorKind.value = null;
    }
    lyricIndex.value = -1;
    lyricLoading.value = false;
    syncToMain();

    // 应用 OpenCC 简繁转换
    const chineseScriptPreference = settings.lyric.chineseScriptPreference;
    if (hasContent && chineseScriptPreference !== "default") {
      applyLyricCjkTransform(nextLines, chineseScriptPreference).then((transformed) => {
        if (currentTransformToken !== transformToken) return;
        parsedLyric.value = transformed;
        syncToMain();
      });
    }
  };

  /**
   * 根据播放时间更新歌词行索引
   * @param time - 播放时间
   */
  const updateLyricIndex = (time: number): void => {
    lyricIndex.value = findLyricIndex(parsedLyric.value, time, lyricIndex.value);
  };

  /** 清空所有状态 */
  const clear = (): void => {
    track.value = null;
    playbackContext.value = undefined;
    detail.value = null;
    activeLyric.value = null;
    lyricContent.value = null;
    parsedLyric.value = [];
    lyricAuthors.value = [];
    lyricAuthorKind.value = null;
    onlineCreators.value = null;
    creatorToken++;
    creatorRequestKey = "";
    lyricLoading.value = false;
    lyricIndex.value = -1;
    syncToMain();
  };

  return {
    track,
    playbackContext,
    detail,
    activeLyric,
    lyricContent,
    lyricFormat,
    parsedLyric,
    lyricAuthors,
    lyricAuthorKind,
    lyricLoading,
    lyricIndex,
    setTrack,
    setPlaybackContext,
    enrichTrack,
    patchCover,
    resetLyricState,
    setLyric,
    updateLyricIndex,
    clear,
  };
});
