<script setup lang="ts">
import {
  LayoutAlignAnchor,
  LayoutReason,
  type LyricLineMouseEvent,
} from "@applemusic-like-lyrics/core";
import type { LyricLine } from "@shared/types/lyrics";
import type { LargerLyricText, LyricFloatAnimationIntensity } from "@/types/settings";
import { SPlayerLyricPlayer as CoreLyricPlayer } from "./amll-player";
import { useSettingsStore } from "@/stores/settings";
import { getOverlapAlignPosition } from "@/utils/lyric/overlapAlign";
import {
  canPromoteLinePronunciation,
  collapseToLineLyric,
  hasWordRomanization,
  promotePronunciation,
  resolveAmlLineRomanization,
  shouldForceAmlLinePronunciationMode,
} from "./romanization";
import "@applemusic-like-lyrics/core/style.css";

/**
 * SPlayer 与 AMLL 补丁之间的私有行协议，不属于上游公开 API。
 * Core 会克隆并优化行数据，升级时必须确认字段仍能到达 LyricLineEl。
 * 消费位置、未迁移字段和验证步骤见根目录 amll-hooks.md。
 */
type AmlLyricLine = LyricLine & {
  /** 关闭逐字高亮，由 Core 重建遮罩时消费 */
  __amllDisableWordHighlight?: true;
  /** 关闭强调，由 Core 构建单词时消费 */
  __amllDisableEmphasize?: true;
  /** 排除 CJK 强调，保留其他词的强调判断 */
  __amllDisableCjkEmphasis?: true;
  /** 上浮强度，由 Core 创建上浮动画时消费 */
  __amllFloatAnimationIntensity?: LyricFloatAnimationIntensity;
  /** 发音提升为主文字时开启双层遮罩；Core.createWord 与遮罩生成器共同消费。 */
  __amllIndependentMainWordMask?: true;
  /** 正文为主文字时开启双层遮罩；两层分别测量宽高并复用 Core 行级时间轴。 */
  __amllIndependentRomanWordMask?: true;
};

const props = withDefaults(
  defineProps<{
    /** 歌词行数据数组 */
    lyricLines: LyricLine[];
    /** 是否正在播放（默认 true） */
    playing?: boolean;
    /** 激活行在容器中的对齐位置 [0 ~ 1] */
    alignPosition?: number;
    /** 逐字掩码渐变宽度比例 */
    wordFadeWidth?: number;
    /** 是否隐藏已播放行 */
    hidePassedLines?: boolean;
    /** 是否启用逐行模糊效果 */
    enableBlur?: boolean;
    /** 是否启用逐字高亮 */
    enableWordHighlight?: boolean;
    /** 逐字上浮动画强度 */
    floatAnimationIntensity?: LyricFloatAnimationIntensity;
    /** 是否启用强调效果 */
    enableEmphasizeEffect?: boolean;
    /** 是否禁用 CJK 歌词的强调效果 */
    disableCjkEmphasis?: boolean;
    /** 多行同亮时是否临时抬高歌词对齐位置 */
    raiseAlignPositionOnOverlap?: boolean;
    /** 是否临时将弹簧参数降至设置范围下限 */
    minimizeSpringParams?: boolean;
    /** 是否显示翻译歌词 */
    showTranslation?: boolean;
    /** 是否显示词内注音 */
    showRuby?: boolean;
    /** 是否显示逐行音译 */
    showRomanization?: boolean;
    /** 是否显示逐词音译 */
    showWordRomanization?: boolean;
    forceSyllableSpacing?: boolean;
    /** 是否将发音显示在翻译上方 */
    swapTranslationPronunciation?: boolean;
    /** 歌词与发音同时显示时的大字体内容 */
    largerLyricText?: LargerLyricText;
    /** 是否强制将逐字歌词的逐行发音提升为逐句主歌词 */
    forceLinePronunciationAsMain?: boolean;
    /** 是否独立计算逐词发音遮罩进度 */
    independentWordRomanizationProgress?: boolean;
    /** 是否始终将背景行置于主行下方 */
    bgAlwaysBelow?: boolean;
    /** 挂载时的初始播放时间（毫秒） */
    initialTime?: number;
  }>(),
  {
    playing: false,
    alignPosition: 0.35,
    wordFadeWidth: 0.5,
    hidePassedLines: false,
    enableBlur: false,
    enableWordHighlight: true,
    floatAnimationIntensity: "medium",
    enableEmphasizeEffect: true,
    disableCjkEmphasis: false,
    raiseAlignPositionOnOverlap: false,
    minimizeSpringParams: false,
    showTranslation: true,
    showRuby: true,
    showRomanization: true,
    showWordRomanization: true,
    forceSyllableSpacing: false,
    swapTranslationPronunciation: false,
    largerLyricText: "lyrics",
    forceLinePronunciationAsMain: false,
    independentWordRomanizationProgress: false,
    bgAlwaysBelow: false,
    initialTime: 0,
  },
);

interface Emits {
  /** 点击歌词行进行播放进度跳转 */
  (e: "seek", timeMs: number): void;
  /** 首次布局完成 */
  (e: "ready"): void;
}

const emit = defineEmits<Emits>();

const settings = useSettingsStore();
let timelineTime = props.initialTime;

const wrapperRef = ref<HTMLDivElement | null>(null);
// Core 实例必须保留原始身份：挂载时用它判定异步等待后实例是否已被卸载或替换。
const playerRef = shallowRef<CoreLyricPlayer>();
const bottomLineEl = ref<HTMLElement>();

// 播放器是否已初始化完成
const initialized = ref(false);
const contentVisible = ref(false);
// 父组件的冻结标志
const isFrozen = ref(false);
// 冻结期间缓存的待应用歌词
let pendingLyrics: LyricLine[] | null = null;
let lastAlignPosition: number | undefined;
let lastAlignAnchor: LayoutAlignAnchor | undefined;
// 页面隐藏状态的响应式跟踪
const isPageHidden = ref(false);
// 之前隐藏的标记，用于检测从隐藏恢复的时刻
const isPreviousHidden = ref(false);

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** 根据时间线快照同步重叠对齐，缓存最终配置以免重复布局 */
const syncAlignPosition = (): void => {
  const player = playerRef.value;
  if (!player) return;
  player.advanceOverlapAnchor(props.raiseAlignPositionOnOverlap);
  const activeMainLineCount = props.raiseAlignPositionOnOverlap
    ? player.getBufferedMainLineCount()
    : 0;
  const overlap = props.raiseAlignPositionOnOverlap ? player.getBufferedMainLineMetrics() : null;
  const alignPosition =
    props.raiseAlignPositionOnOverlap && activeMainLineCount > 1 && overlap
      ? getOverlapAlignPosition(
          props.alignPosition,
          wrapperRef.value?.clientHeight ?? 0,
          overlap.firstHeight,
          overlap.secondHeight,
          overlap.gap,
          overlap.overlapDuration,
        )
      : props.alignPosition;
  const alignAnchor = props.alignPosition > 0.4 ? LayoutAlignAnchor.Center : LayoutAlignAnchor.Top;
  if (lastAlignPosition === alignPosition && lastAlignAnchor === alignAnchor) return;
  lastAlignPosition = alignPosition;
  lastAlignAnchor = alignAnchor;
  player.setAlignPosition(alignPosition);
  player.setAlignAnchor(alignAnchor);
  player.calcLayout(LayoutReason.ConfigChange);
};

/**
 * 保存父组件提供的展示时间并同步重叠段布局
 * @param time - 歌词时间毫秒数
 * @param isSeek - 是否立即定位
 */
const syncCurrentTime = (time: number, isSeek?: boolean): void => {
  timelineTime = time;
  playerRef.value?.setCurrentTime(time, isSeek);
  syncAlignPosition();
};

// 处理多语言显隐及音译偏好的本地高效清洗
const processedLyrics = computed(() => {
  if (!props.lyricLines) return [];
  const forceLineMode =
    props.largerLyricText === "pronunciation" &&
    props.showRomanization &&
    shouldForceAmlLinePronunciationMode(props.lyricLines, props.forceLinePronunciationAsMain);
  const result = props.lyricLines.map((line) => {
    const wordPronunciationVisible = props.showWordRomanization && hasWordRomanization(line);
    const linePronunciationVisible =
      props.showRomanization && !hasWordRomanization(line) && !!line.romanLyric.trim();
    const linePronunciationCanBePromoted =
      linePronunciationVisible && canPromoteLinePronunciation(line, false);
    const displayLine =
      forceLineMode && canPromoteLinePronunciation(line, true)
        ? promotePronunciation(line, "line")
        : forceLineMode
          ? collapseToLineLyric(line)
          : props.largerLyricText === "pronunciation" && wordPronunciationVisible
            ? promotePronunciation(line, "word", props.forceSyllableSpacing)
            : props.largerLyricText === "pronunciation" && linePronunciationCanBePromoted
              ? promotePronunciation(line, "line")
              : line;
    const translation = props.showTranslation ? displayLine.translatedLyric : "";
    const pronunciation = resolveAmlLineRomanization(displayLine, props.showRomanization);
    const newLine: AmlLyricLine = {
      ...displayLine,
      translatedLyric: props.swapTranslationPronunciation ? pronunciation : translation,
      romanLyric: props.swapTranslationPronunciation ? translation : pronunciation,
    };
    if (!props.enableWordHighlight) {
      newLine.__amllDisableWordHighlight = true;
    }
    if (!props.enableEmphasizeEffect) {
      newLine.__amllDisableEmphasize = true;
    }
    if (props.disableCjkEmphasis) {
      newLine.__amllDisableCjkEmphasis = true;
    }
    newLine.__amllFloatAnimationIntensity = props.floatAnimationIntensity;
    // 标记描述发音所在层；任一标记都会拆开两层，否则祖先遮罩仍会裁掉子层高亮。
    if (props.independentWordRomanizationProgress && wordPronunciationVisible) {
      if (props.largerLyricText === "pronunciation") {
        newLine.__amllIndependentMainWordMask = true;
      } else {
        newLine.__amllIndependentRomanWordMask = true;
      }
    }
    if (displayLine.words) {
      newLine.words = displayLine.words.map((word) => {
        const newWord = { ...word };
        if (!props.showWordRomanization) {
          delete newWord.romanWord;
        }
        if (props.showRuby && word.ruby) {
          newWord.ruby = word.ruby.map((span) => ({ ...span }));
        } else {
          delete newWord.ruby;
        }
        return newWord;
      });
    }
    return newLine;
  });
  return result;
});

// 行点击事件回调
const handleLineClick = (event: Event) => {
  const amllEvent = event as LyricLineMouseEvent;
  const lineData = amllEvent.line?.getLine();
  if (lineData && typeof lineData.startTime === "number") {
    emit("seek", lineData.startTime);
    syncCurrentTime(lineData.startTime, true);
  }
};

// 为所有主歌词行设置 html lang 属性
const processLyricLanguage = (player = playerRef.value) => {
  const lyricGroups = player?.currentLyricGroups;
  if (!Array.isArray(lyricGroups) || lyricGroups.length === 0) return;

  for (const group of lyricGroups) {
    for (const line of [group.mainLine, group.bgLine]) {
      const lyricLine = line?.getLine();
      const lyricLineElement = line?.getElement();
      if (!lyricLine || !lyricLineElement) continue;

      lyricLineElement.classList.toggle("amll-line-lyric", !!(lyricLine as LyricLine).isLineLyric);

      const lyricMainLineElement = lyricLineElement.firstChild;
      if (lyricMainLineElement instanceof HTMLElement) {
        const language = (lyricLine as LyricLine).language;
        if (language) lyricMainLineElement.lang = language;
        else lyricMainLineElement.removeAttribute("lang");
      }
    }
  }
};

/** 同步播放器配置 */
const syncPlayerOptions = (player = playerRef.value): void => {
  if (!player) return;
  syncAlignPosition();
  player.setWordFadeWidth(props.wordFadeWidth);
  player.setHidePassedLines(props.hidePassedLines);
  player.setEnableBlur(props.enableBlur);

  const useSpring = settings.lyric.useAMSpring;
  player.setEnableSpring(useSpring);
  player.setEnableScale(useSpring);
  player.setAlwaysPostpositionBackground(props.bgAlwaysBelow ?? false);
  player.setLinePosYSpringParams(
    props.minimizeSpringParams
      ? { mass: 0.1, damping: 0, stiffness: 1, soft: false }
      : {
          mass: settings.lyric.amllVerticalSpringMass,
          damping: settings.lyric.amllVerticalSpringDamping,
          stiffness: settings.lyric.amllVerticalSpringStiffness,
          soft: settings.lyric.amllVerticalSpringSoft,
        },
  );
  player.setLineScaleSpringParams(
    props.minimizeSpringParams
      ? { mass: 0.1, damping: 0, stiffness: 1, soft: false }
      : {
          mass: settings.lyric.amllScaleSpringMass,
          damping: settings.lyric.amllScaleSpringDamping,
          stiffness: settings.lyric.amllScaleSpringStiffness,
          soft: settings.lyric.amllScaleSpringSoft,
        },
  );
};

const { resume: resumeRaf, pause: pauseRaf } = useRafFn(
  ({ delta }) => {
    playerRef.value?.update(delta);
  },
  { immediate: false },
);

/** 隐藏时停止渲染，恢复时使用父组件最近提供的时间 */
const handleVisibility = () => {
  const hidden = document.hidden;
  isPageHidden.value = hidden; // 更新响应式隐藏状态
  if (hidden) {
    pauseRaf();
    playerRef.value?.pause();
    isPreviousHidden.value = true;
  } else if (isPreviousHidden.value && !isFrozen.value && playerRef.value) {
    // 从隐藏恢复
    const currentTime = timelineTime;
    syncCurrentTime(currentTime, true);
    isPreviousHidden.value = false;
  }
};

onMounted(async () => {
  if (!wrapperRef.value) return;
  const player = new CoreLyricPlayer();
  playerRef.value = player;

  const el = player.getElement();
  el.style.width = "100%";
  el.style.height = "100%";
  wrapperRef.value.appendChild(el);

  const bottomEl = player.getBottomLineElement();
  if (bottomEl) {
    bottomEl.classList.add("lp-line", "lp-credit");
    bottomLineEl.value = bottomEl;
  }

  player.addEventListener("line-click", handleLineClick);

  player.setOptimizeOptions({
    cleanUnintentionalOverlaps: settings.lyric.amllCleanUnintentionalOverlaps,
    tryAdvanceStartTime: settings.lyric.amllTryAdvanceStartTime,
    syncMainAndBackgroundLines: settings.lyric.amllSyncMainAndBackgroundLines,
    normalizeSpaces: settings.lyric.amllNormalizeSpaces,
    resetLineTimestamps: settings.lyric.amllResetLineTimestamps,
  });
  syncPlayerOptions(player);
  document.addEventListener("visibilitychange", handleVisibility);

  await nextTick();
  await nextFrame();
  // RAF 回调先于 ResizeObserver，再等一帧让 Core 获得容器尺寸
  await nextFrame();
  if (playerRef.value !== player) return;

  const currentTime = Math.round(props.initialTime);
  if (props.playing) player.resume();
  else player.pause();
  // 等待期间可能更新歌词，使用此时的最新数据避免再次重建视图
  pendingLyrics = null;
  player.setLyricLines(processedLyrics.value, currentTime);
  syncCurrentTime(currentTime, true);
  player.update(0);
  processLyricLanguage(player);
  initialized.value = true;
  contentVisible.value = true;
  emit("ready");
});

onUnmounted(() => {
  document.removeEventListener("visibilitychange", handleVisibility);
  pauseRaf();
  initialized.value = false;
  contentVisible.value = false;
  if (playerRef.value) {
    playerRef.value.removeEventListener("line-click", handleLineClick);
    playerRef.value.dispose();
    playerRef.value = undefined;
    bottomLineEl.value = undefined;
  }
});

// 同步播放/冻结状态到 Core 及渲染循环
watchEffect(() => {
  const player = playerRef.value;
  if (!player || !initialized.value) return;

  const playing = props.playing;
  const frozen = isFrozen.value;
  const hidden = isPageHidden.value; // 使用响应式隐藏状态

  if (!frozen && !hidden) {
    // 只要未冻结且可见，就持续运行 RAF 维持渲染（即使暂停也要保持画面）
    resumeRaf();
    if (playing) {
      player.resume();
    } else {
      player.pause();
    }
  } else {
    pauseRaf();
    player.pause();
  }
});

watch(
  () => [
    props.alignPosition,
    props.raiseAlignPositionOnOverlap,
    props.wordFadeWidth,
    props.hidePassedLines,
    props.enableBlur,
    props.minimizeSpringParams,
    props.bgAlwaysBelow,
    settings.lyric.useAMSpring,
    settings.lyric.amllVerticalSpringMass,
    settings.lyric.amllVerticalSpringDamping,
    settings.lyric.amllVerticalSpringStiffness,
    settings.lyric.amllVerticalSpringSoft,
    settings.lyric.amllScaleSpringMass,
    settings.lyric.amllScaleSpringDamping,
    settings.lyric.amllScaleSpringStiffness,
    settings.lyric.amllScaleSpringSoft,
  ],
  () => syncPlayerOptions(),
);

// 监听处理完的歌词数据变动
watch(processedLyrics, (newLyrics) => {
  if (!playerRef.value) return;
  if (!initialized.value || isFrozen.value) {
    pendingLyrics = newLyrics;
  } else {
    const currentTime = timelineTime;
    playerRef.value.setLyricLines(newLyrics, currentTime);
    syncCurrentTime(currentTime, true);
    processLyricLanguage();
  }
});

// 监听歌词优化配置变动并更新 Core
watch(
  () => ({
    cleanUnintentionalOverlaps: settings.lyric.amllCleanUnintentionalOverlaps,
    tryAdvanceStartTime: settings.lyric.amllTryAdvanceStartTime,
    syncMainAndBackgroundLines: settings.lyric.amllSyncMainAndBackgroundLines,
    normalizeSpaces: settings.lyric.amllNormalizeSpaces,
    resetLineTimestamps: settings.lyric.amllResetLineTimestamps,
  }),
  (options) => {
    if (!playerRef.value) return;
    playerRef.value.setOptimizeOptions(options);
    if (processedLyrics.value.length > 0 && !isFrozen.value) {
      const currentTime = timelineTime;
      playerRef.value.setLyricLines(processedLyrics.value, currentTime);
      syncCurrentTime(currentTime, true);
      processLyricLanguage();
    }
  },
  { deep: true },
);

/**
 * 接收主播放器或独立预览的时间
 * @param time - 歌词时间毫秒数
 * @param isSeek - 是否立即定位
 */
const setCurrentTime = (time: number, isSeek?: boolean) => {
  syncCurrentTime(time, isSeek);
};

/**
 * 强制滚动歌词到指定播放时间。
 * @param time - 播放时间（毫秒）
 */
const scrollToTime = (time: number): void => {
  syncCurrentTime(time, true);
};

// 隐藏界面或休眠时调用
const freeze = () => {
  isFrozen.value = true;
};

/** 恢复渲染并应用冻结期间的歌词 */
const resume = () => {
  if (!initialized.value) {
    isFrozen.value = false;
    return;
  }
  if (pendingLyrics) {
    const currentTime = timelineTime;
    playerRef.value?.setLyricLines(pendingLyrics, currentTime);
    syncCurrentTime(currentTime, true);
    processLyricLanguage();
    pendingLyrics = null;
  }
  isFrozen.value = false;
};

defineExpose({
  setCurrentTime,
  scrollToTime,
  freeze,
  resume,
  lyricPlayer: playerRef,
});
</script>

<template>
  <div ref="wrapperRef" class="amll-lyrics-container" :class="contentVisible ? 'is-visible' : ''" />
  <Teleport v-if="bottomLineEl" :to="bottomLineEl">
    <slot name="bottom">
      <LyricCredit />
    </slot>
  </Teleport>
</template>

<style scoped>
.amll-lyrics-container {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  user-select: none;
  opacity: 0;
  transition: opacity 120ms cubic-bezier(0.2, 0, 0, 1);
}

.amll-lyrics-container.is-visible {
  opacity: 1;
}

/* auto 隐含 paint containment；视口附近的构建仍由 core 的可见性检测控制。 */
:deep(.FmKaba_lyricLine) {
  contain: layout style;
  content-visibility: visible;
  overflow: visible;
}

:deep(.amll-lyric-player) {
  --amll-lp-font-size: 1em;
  --amll-lp-color: var(--lp-color, #fff);
  width: 100%;
  height: 100%;
}

/* AMLL core 将副行字号硬编码为 max(.5em, 10px)，此处改用应用侧配置 */
:deep([class*="lyricSubLine"]) {
  font-size: var(--lp-sub-font-size, max(0.5em, 10px));
}

:deep(:lang(zh)),
:deep(:lang(yue)) {
  font-family: var(--lyric-font-zh, inherit);
}

:deep(:lang(ja)) {
  font-family: var(--lyric-font-ja, inherit);
}

:deep(:lang(ko)) {
  font-family: var(--lyric-font-ko, inherit);
}

:deep(:lang(und-Latn)) {
  font-family: var(--lyric-font-latin, inherit);
}

:deep(.amll-line-lyric > :first-child *) {
  mask-image: none !important;
  -webkit-mask-image: none !important;
}

:deep(.lp-line.lp-credit) {
  position: absolute !important;
  left: 0 !important;
  width: 100% !important;
  max-width: 100% !important;
  box-sizing: border-box !important;
  margin: 0 !important;
  padding-top: 0.5em !important;
  padding-left: var(--lyric-line-padding-x, 1em) !important;
  padding-right: var(--lyric-line-padding-x, 1em) !important;
  text-align: left !important;
  display: flex !important;
  align-items: center !important;
  justify-content: flex-start !important;
  font-size: inherit !important;
  line-height: 1.4 !important;
  pointer-events: auto !important;
  z-index: 10 !important;
  background: none !important;
  background-color: transparent !important;
  box-shadow: none !important;
  border: none !important;
  outline: none !important;
  contain: none !important;
  overflow: visible !important;
}

:deep(.lp-line.lp-credit:hover),
:deep(.lp-line.lp-credit:active),
:deep([class*="bottomLine"]),
:deep([class*="bottomLine"]:hover),
:deep([class*="bottomLine"]:active) {
  background: none !important;
  background-color: transparent !important;
  box-shadow: none !important;
  border: none !important;
  outline: none !important;
}

@media (max-width: 990px) {
  :deep(.lp-line.lp-credit) {
    padding-left: var(--lyric-line-padding-x, 1em) !important;
    padding-right: var(--lyric-line-padding-x, 1em) !important;
  }
}
</style>
