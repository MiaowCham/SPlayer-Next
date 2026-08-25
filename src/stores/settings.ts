import type {
  ChineseScriptPreference,
  PlayerSettings,
  LyricSettings,
  AppearanceSettings,
  SpringPreset,
  PresetSettings,
  ExperimentalSettings,
} from "@/types/settings";
import {
  DEFAULT_LYRIC_FORMAT_ORDER,
  DEFAULT_LYRIC_SOURCE_ORDER,
  normalizeLyricEarlyEndMode,
  normalizePlayerBgType,
  SPRING_PRESETS,
} from "@/types/settings";
import type { SystemConfig, LocaleCode } from "@shared/types/settings";
import { defaultSystemConfig } from "@shared/defaults/settings";
import { setByPath } from "@shared/utils/path";

/**
 * 对账有序集合：保留存档中仍有效的项（顺序不变），
 * 末尾补上完整集合里缺失的新项，剔除已失效的项
 * 用于平台/格式偏好——新增平台或格式时无需用户手动重置即可生效
 * @param stored - 存档顺序
 * @param all - 当前完整集合
 * @returns 对账后的顺序
 */
const reconcileOrder = <T>(stored: T[], all: readonly T[]): T[] => {
  const known = stored.filter((item) => all.includes(item));
  const missing = all.filter((item) => !known.includes(item));
  return [...known, ...missing];
};

const normalizeBoundedNumber = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

/** 将旧连续模糊值迁移为四档模糊等级。 */
const normalizeAppleMusicBlurLevel = (value: unknown): number => {
  const numeric = normalizeBoundedNumber(value, 2, 0, 3);
  if (numeric === 1.5) return 2;
  if (Number.isInteger(numeric)) return numeric;
  if (numeric < 1) return 0;
  if (numeric < 2) return 1;
  if (numeric < 3) return 2;
  return 3;
};

/** 关闭实验入口时复位歌词实验功能。 */
const resetExperimentalLyricSettings = (lyric: LyricSettings): void => {
  lyric.largerLyricText = "lyrics";
  lyric.forceLinePronunciationAsMain = false;
  lyric.independentWordRomanizationProgress = false;
  lyric.maxHighlightedLines = "unlimited";
  lyric.earlyEndMode = "off";
  lyric.earlyEndAdvanceToNextLine = false;
  lyric.lineSelectionPreference = "default";
};

export const useSettingsStore = defineStore(
  "settings",
  () => {
    /** 界面语言 */
    const locale = ref<LocaleCode>("zh-CN");

    /** 外观 */
    const appearance = reactive<AppearanceSettings>({
      layoutMode: "default",
      routeTransition: "fade",
      sidebarCollapsed: false,
      sidebarShortcutToggle: false,
      sidebarPlaylistCover: false,
      showStatsInSidebar: true,
      showQualitySwitch: false,
      closeAction: "hide",
      rememberCloseChoice: false,
      fontFamily: "",
      showPerformanceMonitor: false,
    });

    /** 播放器 */
    const player = reactive<PlayerSettings>({
      playerBgType: "blur",
      appleMusicBgEnabled: false,
      playerBgFps: 30,
      playerBgFlowSpeed: 4,
      playerBgRenderScale: 0.5,
      playerBgFreezeOnPause: false,
      playerBgBeat: false,
      appleMusicBgFps: 30,
      appleMusicBgFlowSpeed: 1,
      appleMusicBgDistortion: 1,
      appleMusicBgRenderScale: 0.5,
      appleMusicBgBlurStrength: 2,
      appleMusicBgDimness: 0.1,
      appleMusicBgFreezeOnPause: false,
      appleMusicBgBeat: true,
      appleMusicBgBeatStrength: 1,
      coverLayout: "default",
      autoCenterCover: true,
      showPlaybackSource: false,
      followCoverColor: true,
      autoImmersive: true,
      outputDevice: null,
      pauseOnDeviceSwitch: false,
      enableSpectrum: false,
      spectrumBarWidth: 4,
      reverseSpectrum: false,
      songLevel: "hq",
      allowTrialPlay: false,
      timeFormat: "current-total",
      showProgressTooltip: true,
      showProgressLyric: false,
      snapToLyric: false,
      followLyricOnProgressDrag: false,
      showLyricInBar: true,
      preloadNextTrack: false,
    });

    /** 实验性功能 */
    const experimental = reactive<ExperimentalSettings>({
      enabled: false,
    });

    /** 强迫症设置 */
    const preset = reactive<PresetSettings>({
      fuckDjMode: false,
      uncensorProfanity: false,
      hideVipTag: false,
      hideQualityTag: false,
      showSubtitle: true,
    });

    /** 歌词 */
    const lyric = reactive<LyricSettings>({
      lyricSourcePreference: "auto",
      lyricSourceOrder: [...DEFAULT_LYRIC_SOURCE_ORDER],
      lyricFormatOrder: [...DEFAULT_LYRIC_FORMAT_ORDER],
      smartPreferOnline: false,
      detectBackgroundLyrics: true,
      chineseScriptPreference: "default",
      adaptiveFontSize: true,
      fontSize: 48,
      fontWeight: 700,
      lyricBlendMode: "normal",
      swapTranslationPronunciation: false,
      largerLyricText: "lyrics",
      forceLinePronunciationAsMain: false,
      fontFamily: "",
      fontFamilyLatin: "",
      fontFamilyJapanese: "",
      fontFamilyKorean: "",
      fontFamilyChinese: "",
      showTranslation: true,
      fallbackTranslation: true,
      showRomanization: true,
      amllShowLineRomanization: true,
      amllShowWordRomanization: true,
      independentWordRomanizationProgress: false,
      enableWordHighlight: true,
      floatAnimationIntensity: "medium",
      enableEmphasizeEffect: false,
      disableCjkEmphasis: false,
      maxHighlightedLines: "unlimited",
      multiLineOverlapThreshold: 490,
      earlyEndMode: "off",
      earlyEndGapThreshold: 1300,
      earlyEndAdvance: 700,
      earlyEndScrollLead: 850,
      earlyEndAdvanceToNextLine: false,
      lineSelectionPreference: "default",
      raiseAlignPositionOnOverlap: false,
      enableBlur: false,
      hidePassedLines: false,
      springPreset: "default",
      springMass: 0.9,
      springDamping: 15,
      springStiffness: 90,
      alignPosition: 0.35,
      wordFadeWidth: 0.5,
      inactiveAlpha: 0.2,
      enableExcludeLyrics: true,
      excludeLyricsUserKeywords: [],
      excludeLyricsUserRegexes: [],
      engine: "physics",
      useAMSpring: true,
      amllVerticalSpringMass: 1,
      amllVerticalSpringDamping: 15,
      amllVerticalSpringStiffness: 100,
      amllVerticalSpringSoft: false,
      amllScaleSpringMass: 1,
      amllScaleSpringDamping: 20,
      amllScaleSpringStiffness: 100,
      amllScaleSpringSoft: false,
    });

    /** 系统配置 - 传递主进程 */
    const system = reactive<SystemConfig>(structuredClone(defaultSystemConfig));

    /** 桌面歌词窗口是否打开；由主进程广播 */
    const isDesktopLyricOpen = ref(false);

    /** 灵动岛窗口是否打开；由主进程广播 */
    const isDynamicIslandOpen = ref(false);

    /** 任务栏歌词窗口是否打开；由主进程广播 */
    const isTaskbarLyricOpen = ref(false);

    /**
     * 深合并：嵌套对象原地 mutate，叶子值不变就不写
     * 避免浅 Object.assign 替换嵌套引用，导致依赖路径的 watcher 误触
     */
    const deepAssign = (target: Record<string, unknown>, source: Record<string, unknown>): void => {
      for (const key of Object.keys(source)) {
        const next = source[key];
        const cur = target[key];
        if (
          next &&
          typeof next === "object" &&
          !Array.isArray(next) &&
          cur &&
          typeof cur === "object" &&
          !Array.isArray(cur)
        ) {
          deepAssign(cur as Record<string, unknown>, next as Record<string, unknown>);
        } else if (cur !== next) {
          target[key] = next;
        }
      }
    };

    /** 从主进程拉取后端配置 */
    const syncSystem = async (): Promise<void> => {
      try {
        deepAssign(
          system as unknown as Record<string, unknown>,
          (await window.api.config.getAll()) as unknown as Record<string, unknown>,
        );
      } catch {}
    };

    /** IPC 订阅取消回调集合 */
    const unsubscribers: Array<() => void> = [
      // 订阅桌面歌词配置变化：歌词窗口点锁定按钮等场景需要回流到主窗口设置页
      window.api.desktopLyric.onConfigChange((next) => {
        Object.assign(system.desktopLyric, next as object);
      }),
      // 订阅桌面歌词窗口开关状态
      window.api.window.onDesktopLyricVisibilityChange((open) => {
        isDesktopLyricOpen.value = open;
      }),
      // 订阅灵动岛配置变化
      window.api.dynamicIsland.onConfigChange((next) => {
        Object.assign(system.dynamicIsland, next as object);
      }),
      // 订阅灵动岛窗口开关状态
      window.api.window.onDynamicIslandVisibilityChange((open) => {
        isDynamicIslandOpen.value = open;
      }),
      // 订阅任务栏歌词窗口开关状态
      window.api.window.onTaskbarLyricVisibilityChange((open) => {
        isTaskbarLyricOpen.value = open;
      }),
    ];

    onScopeDispose(() => {
      for (const off of unsubscribers) off();
      unsubscribers.length = 0;
    });

    // 拉取窗口初始开关状态
    window.api.window
      .isDesktopLyricOpen()
      .then((open) => {
        isDesktopLyricOpen.value = open;
      })
      .catch(() => {});
    window.api.window
      .isDynamicIslandOpen()
      .then((open) => {
        isDynamicIslandOpen.value = open;
      })
      .catch(() => {});
    window.api.window
      .isTaskbarLyricOpen()
      .then((open) => {
        isTaskbarLyricOpen.value = open;
      })
      .catch(() => {});

    /**
     * 写入后端配置并同步本地
     * 先就地 mutate 叶子保证 UI 即时反馈，IPC 落盘异步执行
     */
    const setSystem = async (keyPath: string, value: unknown): Promise<void> => {
      setByPath(system, keyPath, value);
      try {
        await window.api.config.set(keyPath, value);
      } catch (err) {
        console.error("[settings] config.set failed", keyPath, err);
      }
      if (keyPath === "player.fadeEnabled" || keyPath === "player.fadeDuration") {
        await window.api.player.setFadeDuration(
          system.player.fadeEnabled ? system.player.fadeDuration : 0,
        );
      }
    };

    /** 本地配置写入后处理 */
    const afterLocalChange = (path: string, value: unknown): void => {
      if (path === "lyric.springPreset" && value !== "custom") {
        const params = SPRING_PRESETS[value as Exclude<SpringPreset, "custom">];
        lyric.springMass = params.mass;
        lyric.springDamping = params.damping;
        lyric.springStiffness = params.stiffness;
      }
    };

    /** 关闭并复位所有实验性功能。 */
    const disableExperimentalFeatures = (): void => {
      experimental.enabled = false;
      if (player.playerBgType === "apple-music-dev" || player.playerBgType === "apple-music-beta") {
        player.playerBgType = "animation";
      }
      resetExperimentalLyricSettings(lyric);
    };

    return {
      locale,
      appearance,
      player,
      experimental,
      preset,
      lyric,
      system,
      isDesktopLyricOpen,
      isDynamicIslandOpen,
      isTaskbarLyricOpen,
      syncSystem,
      setSystem,
      afterLocalChange,
      disableExperimentalFeatures,
    };
  },
  {
    persist: {
      storage: localStorage,
      omit: ["system"],
      afterHydrate: ({ store }) => {
        const { lyric } = store as unknown as { lyric: LyricSettings };
        const legacyLyric = lyric as LyricSettings & { cjkTransform?: string };
        const legacyPreferenceMap: Record<string, ChineseScriptPreference> = {
          none: "default",
          t2s: "simplified",
          tw2s: "simplified",
          hk2s: "simplified",
          tw2sp: "simplified",
          s2t: "traditional",
          s2tw: "traditional",
          s2hk: "traditional",
          s2twp: "traditional",
        };
        if (legacyLyric.cjkTransform) {
          lyric.chineseScriptPreference =
            legacyPreferenceMap[legacyLyric.cjkTransform] ?? "default";
          delete legacyLyric.cjkTransform;
        }
        if (
          !(["default", "simplified", "traditional"] as const).includes(
            lyric.chineseScriptPreference,
          )
        ) {
          lyric.chineseScriptPreference = "default";
        }
        const { player, experimental } = store as unknown as {
          player: PlayerSettings;
          experimental: ExperimentalSettings;
        };
        player.playerBgType = normalizePlayerBgType(player.playerBgType);
        const usesAppleMusicBg =
          player.playerBgType === "apple-music-dev" || player.playerBgType === "apple-music-beta";
        if (typeof player.appleMusicBgEnabled !== "boolean") {
          player.appleMusicBgEnabled = usesAppleMusicBg;
        }
        if (typeof experimental.enabled !== "boolean") {
          experimental.enabled = false;
        }
        if (!experimental.enabled && usesAppleMusicBg) {
          player.playerBgType = "animation";
        }
        if (!experimental.enabled) {
          resetExperimentalLyricSettings(lyric);
        }
        player.appleMusicBgFlowSpeed = normalizeBoundedNumber(
          player.appleMusicBgFlowSpeed,
          1,
          0.5,
          10,
        );
        player.appleMusicBgDistortion = normalizeBoundedNumber(
          player.appleMusicBgDistortion,
          1,
          0,
          2,
        );
        player.appleMusicBgBlurStrength = normalizeAppleMusicBlurLevel(
          player.appleMusicBgBlurStrength,
        );
        player.appleMusicBgDimness = normalizeBoundedNumber(
          player.appleMusicBgDimness,
          0.1,
          0,
          0.6,
        );
        player.appleMusicBgBeatStrength = normalizeBoundedNumber(
          player.appleMusicBgBeatStrength,
          1,
          0.25,
          10,
        );
        if (typeof lyric.detectBackgroundLyrics !== "boolean") {
          lyric.detectBackgroundLyrics = true;
        }
        if (typeof lyric.fallbackTranslation !== "boolean") {
          lyric.fallbackTranslation = true;
        }
        if (typeof lyric.swapTranslationPronunciation !== "boolean") {
          lyric.swapTranslationPronunciation = false;
        }
        if (!(["lyrics", "pronunciation"] as const).includes(lyric.largerLyricText)) {
          lyric.largerLyricText = "lyrics";
        }
        if (typeof lyric.forceLinePronunciationAsMain !== "boolean") {
          lyric.forceLinePronunciationAsMain = false;
        }
        if (typeof lyric.independentWordRomanizationProgress !== "boolean") {
          lyric.independentWordRomanizationProgress = false;
        }
        if (typeof lyric.disableCjkEmphasis !== "boolean") {
          lyric.disableCjkEmphasis = false;
        }
        if (!([2, 3, "unlimited"] as const).includes(lyric.maxHighlightedLines)) {
          lyric.maxHighlightedLines = "unlimited";
        }
        lyric.multiLineOverlapThreshold = normalizeBoundedNumber(
          lyric.multiLineOverlapThreshold,
          490,
          0,
          3000,
        );
        lyric.earlyEndMode = normalizeLyricEarlyEndMode(lyric.earlyEndMode);
        lyric.earlyEndGapThreshold = normalizeBoundedNumber(
          lyric.earlyEndGapThreshold,
          1300,
          0,
          3000,
        );
        lyric.earlyEndAdvance = normalizeBoundedNumber(lyric.earlyEndAdvance, 700, 100, 2000);
        lyric.earlyEndScrollLead = normalizeBoundedNumber(lyric.earlyEndScrollLead, 850, 500, 3000);
        if (typeof lyric.earlyEndAdvanceToNextLine !== "boolean") {
          lyric.earlyEndAdvanceToNextLine = false;
        }
        if (!(["default", "early-end"] as const).includes(lyric.lineSelectionPreference)) {
          lyric.lineSelectionPreference = "default";
        }
        if (typeof lyric.raiseAlignPositionOnOverlap !== "boolean") {
          lyric.raiseAlignPositionOnOverlap = false;
        }
        if (typeof store.appearance.sidebarShortcutToggle !== "boolean") {
          store.appearance.sidebarShortcutToggle = false;
        }
        if (
          !(["low", "medium", "high", "very-high", "extreme"] as const).includes(
            lyric.floatAnimationIntensity,
          )
        ) {
          lyric.floatAnimationIntensity = "medium";
        }
        lyric.lyricSourceOrder = reconcileOrder(lyric.lyricSourceOrder, DEFAULT_LYRIC_SOURCE_ORDER);
        lyric.lyricFormatOrder = reconcileOrder(lyric.lyricFormatOrder, DEFAULT_LYRIC_FORMAT_ORDER);
      },
    },
  },
);
