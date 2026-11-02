<script setup lang="ts">
import { LayoutAlignAnchor, LayoutReason } from "@applemusic-like-lyrics/core";
import type { LyricLine } from "@shared/types/lyrics";
import { detectTextLanguage } from "@/utils/lyric/language";
import type { LargerLyricText, LyricFloatAnimationIntensity } from "@/types/settings";
import { SPlayerLyricPlayer as CoreLyricPlayer } from "./amll-player";
import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import { getCurrentTime } from "@/services/playback";
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
import "./renderer.css";

/**
 * SPlayer 与 AMLL 补丁之间的私有行协议，不属于上游公开 API。
 * Core 会克隆并优化行数据，升级时必须确认字段仍能到达 LyricLineEl。
 * 消费位置、未迁移字段和验证步骤见根目录 amll-hooks.md。
 */
type AmlLyricLine = LyricLine & {
  /** 旧版关闭逐字高亮 hook；当前 0.5.2 补丁未迁移其消费者。 */
  __amllDisableWordHighlight?: true;
  /** 旧版关闭强调 hook；当前 0.5.2 补丁未迁移其消费者。 */
  __amllDisableEmphasize?: true;
  /** 旧版排除 CJK 强调 hook；当前 0.5.2 补丁未迁移其消费者。 */
  __amllDisableCjkEmphasis?: true;
  /** 旧版上浮强度 hook；当前 0.5.2 补丁未迁移其消费者。 */
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
    /** 是否显示逐行音译 */
    showLineRomanization?: boolean;
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
    showLineRomanization: true,
    showWordRomanization: true,
    forceSyllableSpacing: false,
    swapTranslationPronunciation: false,
    largerLyricText: "lyrics",
    forceLinePronunciationAsMain: false,
    independentWordRomanizationProgress: false,
    initialTime: 0,
  },
);

interface Emits {
  /** 棣栨灏忓竷灞€瀹屾垚 */
  (e: "ready"): void;
  /** 点击歌词行进行播放进度跳转 */
  (e: "seek", timeMs: number): void;
}

const emit = defineEmits<Emits>();

const settings = useSettingsStore();
const status = useStatusStore();

const wrapperRef = ref<HTMLDivElement | null>(null);

/** 容器尺寸监听，尺寸变化后需要重排歌词 */
let resizeObserver: ResizeObserver | undefined;
/** 监听行元素重建，重建后需要重新应用行语言与字体 */
let rowObserver: MutationObserver | undefined;
/** 行重建后的重应用调度句柄 */
let rowApplyHandle: number | undefined;
/** 时间线采样定时器 */
let tickTimer: number | undefined;
/** 最近一次外部时间推送时刻，用于判断核心时钟是否停住 */
let lastSyncAt = 0;
/** 自检计数，每 8 次（2 秒）打一条日志 */
let tickCount = 0;
// Core 实例必须保留原始身份：挂载时用它判定异步等待后实例是否已被卸载或替换。
const playerRef = shallowRef<CoreLyricPlayer>();
const bottomLineEl = ref<HTMLElement>();
const clockInitialized = ref(false);
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

/**
 * 将重叠高亮状态接入 AMLL 的对齐配置与布局刷新。
 * 0.5.2 的两个 setter 仅写入 layoutState，切换时必须显式调用 calcLayout。
 * 缓存最终对齐点，避免每次播放进度推送都触发布局；升级时复核 setter 的刷新语义。
 */
const syncAlignPosition = (): void => {
  const player = playerRef.value;
  if (!player) return;
  if (props.raiseAlignPositionOnOverlap) player.advanceOverlapAnchor();
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

/** 同步时间后更新重叠段布局，确保新对齐点立即生效。 */
const syncCurrentTime = (time: number, isSeek?: boolean): void => {
  lastSyncAt = performance.now();
  playerRef.value?.setCurrentTime(time, isSeek);
  syncAlignPosition();
  // 跳转后 0.6 可能重建行元素，内联字体会随之丢失，这里补挂一次
  if (isSeek) processLyricLanguage();
};

// 处理多语言显隐及音译偏好的本地高效清洗
const processedLyrics = computed(() => {
  if (!props.lyricLines) return [];
  const forceLineMode =
    props.largerLyricText === "pronunciation" &&
    props.showLineRomanization &&
    shouldForceAmlLinePronunciationMode(props.lyricLines, props.forceLinePronunciationAsMain);
  const result = props.lyricLines.map((line) => {
    const wordPronunciationVisible = props.showWordRomanization && hasWordRomanization(line);
    const linePronunciationVisible =
      props.showLineRomanization && !hasWordRomanization(line) && !!line.romanLyric.trim();
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
    const pronunciation = resolveAmlLineRomanization(displayLine, props.showLineRomanization);
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
        return newWord;
      });
    }
    return newLine;
  });
  return result;
});

// 行点击事件回调
const handleLineClick = (e: Event) => {
  const amllEvent = e as Event & { line?: { getLine: () => { startTime?: number } } };
  const lineData = amllEvent.line?.getLine();
  if (lineData && typeof lineData.startTime === "number") {
    emit("seek", lineData.startTime);
    syncCurrentTime(lineData.startTime, true);
  }
};

// 为所有主歌词行设置 html lang 属性
/** 西文优先的兜底字体栈，避免西文落到中文字体的拉丁字形上 */
const LATIN_FIRST_STACK =
  '-apple-system, "SF Pro Text", "Helvetica Neue", "Segoe UI", Arial, sans-serif';

/**
 * 按语种取设置里的字体族
 *
 * 翻译、音译、背景行不在同一层容器，靠 :lang() 的 CSS 变量可能拿不到，
 * 这里显式解析字体族，作为兜底写入内联样式。
 *
 * @param language - 行或叶子节点的语种
 * @returns 字体族字符串，未配置时退回全局歌词字体
 */
const lyricFontFamilyFor = (language?: string): string => {
  const lyric = settings.lyric;
  if (language === "zh-CN" || language === "yue")
    return lyric.fontFamilyChinese || lyric.fontFamily;
  if (language === "ja") return lyric.fontFamilyJapanese || lyric.fontFamily;
  if (language === "ko") return lyric.fontFamilyKorean || lyric.fontFamily;
  if (language === "und-Latn") return lyric.fontFamilyLatin || LATIN_FIRST_STACK;
  return lyric.fontFamily;
};

const processLyricLanguage = (player = playerRef.value) => {
  const lyricGroups = player?.currentLyricGroups;
  if (!Array.isArray(lyricGroups) || lyricGroups.length === 0) return;

  for (const group of lyricGroups) {
    for (const [lineIndex, line] of [group.mainLine, group.bgLine].entries()) {
      const lyricLine = line?.getLine();
      const lyricLineElement = line?.getElement();
      if (!lyricLine || !lyricLineElement) continue;

      lyricLineElement.classList.toggle("amll-line-lyric", !!(lyricLine as LyricLine).isLineLyric);

      const lyricMainLineElement = lyricLineElement.firstChild;
      if (lyricMainLineElement instanceof HTMLElement) {
        const lyricLineInfo = lyricLine as LyricLine;
        const lineText = lyricLineInfo.words.map((word) => word.word).join("");
        // 副行：翻译是中文、音译是拉丁，直接按内容定性，避免沿用主行语言（日文歌的翻译会拿到日文字体）
        // 优先按实际文本判定语种：AMLL 给的 language 常为 und-Hani 或空值，
        // 会让主行落到容器字体，英文用上中文字体的拉丁字形
        const detectedLanguage = detectTextLanguage(lineText);
        const language =
          lineIndex === 1
            ? lyricLineInfo.translatedLyric
              ? (detectTextLanguage(lyricLineInfo.translatedLyric) ?? "zh-CN")
              : lyricLineInfo.romanLyric
                ? "und-Latn"
                : (detectedLanguage ?? lyricLineInfo.language)
            : (detectedLanguage ?? lyricLineInfo.language);
        // 行根元素也带 lang，副行（音译/翻译）才会命中对应语种字体
        if (language) {
          lyricLineElement.lang = language;
          lyricMainLineElement.lang = language;
        } else {
          lyricLineElement.removeAttribute("lang");
          lyricMainLineElement.removeAttribute("lang");
        }
        // 副行（翻译、音译）是独立的 .FmKaba_lyricSubLine，可能同时存在多个，
        // 逐个按自身内容取字体，否则后一个会继承主行语种字体
        for (const subLine of lyricLineElement.querySelectorAll<HTMLElement>(
          '[class*="lyricSubLine"]',
        )) {
          const subText = subLine.textContent ?? "";
          if (!subText.trim()) continue;
          const subLanguage = detectTextLanguage(subText) ?? "zh-CN";
          subLine.lang = subLanguage;
          const subFamily = lyricFontFamilyFor(subLanguage);
          if (subFamily) subLine.style.fontFamily = subFamily;
        }
        for (const roman of lyricLineElement.querySelectorAll<HTMLElement>(
          '[class*="romanWord"]',
        )) {
          roman.lang = "und-Latn";
          const romanFamily = lyricFontFamilyFor("und-Latn");
          if (romanFamily) roman.style.fontFamily = romanFamily;
        }
      }
    }
  }
  const root = wrapperRef.value;

  // 背景和声行由内核单独渲染，重排后可能丢失 lang，按类名兜底一次
  if (root) {
    for (const bgLine of root.querySelectorAll<HTMLElement>('[class*="lyricBgLine"]')) {
      const bgText = bgLine.textContent ?? "";
      if (!bgText.trim()) continue;
      bgLine.lang = detectTextLanguage(bgText) ?? "und-Latn";
      // 背景行里可能同时有原文与译文，整行判定会一律落到中文，
      // 因此逐个文本叶子节点按自身内容取字体
      let styled = false;
      for (const leaf of bgLine.querySelectorAll<HTMLElement>("*")) {
        if (leaf.children.length > 0) continue;
        const leafText = leaf.textContent ?? "";
        if (!leafText.trim()) continue;
        const leafLanguage = detectTextLanguage(leafText) ?? "und-Latn";
        const leafFamily = lyricFontFamilyFor(leafLanguage);
        if (leafFamily) leaf.style.fontFamily = leafFamily;
        else leaf.style.removeProperty("font-family");
        styled = true;
      }
      if (!styled) {
        const bgFamily = lyricFontFamilyFor(detectTextLanguage(bgText) ?? "und-Latn");
        if (bgFamily) bgLine.style.fontFamily = bgFamily;
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

// 页面隐藏时停止渲染循环，恢复时校准时间线
const handleVisibility = () => {
  const hidden = document.hidden;
  isPageHidden.value = hidden; // 更新响应式隐藏状态
  if (hidden) {
    pauseRaf();
    playerRef.value?.pause();
    isPreviousHidden.value = true;
  } else if (isPreviousHidden.value && !isFrozen.value && playerRef.value) {
    // 从隐藏恢复：校准 Core 内部时钟到当前播放位置，避免逐词效果从头开始
    const currentTime = getCurrentTime() + status.lyricOffsetMs;
    syncCurrentTime(currentTime, true);
    isPreviousHidden.value = false;
    // 恢复后根据当前状态决定 resume/pause（由 watchEffect 处理，这里只需确保 state sync）
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
    convertExcessiveBackgroundLines: settings.lyric.amllConvertExcessiveBackgroundLines,
    syncMainAndBackgroundLines: settings.lyric.amllSyncMainAndBackgroundLines,
    normalizeSpaces: settings.lyric.amllNormalizeSpaces,
    resetLineTimestamps: settings.lyric.amllResetLineTimestamps,
  });
  syncPlayerOptions(player);
  document.addEventListener("visibilitychange", handleVisibility);

  await nextTick();
  await nextFrame();
  if (playerRef.value !== player) return;

  // 抽屉展开动画期间容器高度可能仍为 0，此时下发歌词会让核心按 0 高度排版并停在视口外
  // 布局切换时新容器可能短暂为 0 高度，等太久会让歌词晚一步出现；
  // 只等少量帧，仍为 0 也先下发，后续 ResizeObserver 会按真实尺寸重排
  for (let attempt = 0; attempt < 8; attempt++) {
    if ((wrapperRef.value?.clientHeight ?? 0) > 0) break;
    await nextFrame();
  }
  if (playerRef.value !== player) return;
  player.onResize();

  if (processedLyrics.value.length > 0) {
    const startedAt = performance.now();
    const prepared = processedLyrics.value;
    const preparedAt = performance.now();
    player.setLyricLines(prepared, props.initialTime);
    syncCurrentTime(props.initialTime, true);
    processLyricLanguage(player);
    void window.api.lyrics.log(
      "info",
      `[perf] amll mount prepare=${Math.round(preparedAt - startedAt)}ms setLines=${Math.round(performance.now() - preparedAt)}ms lines=${prepared.length}`,
    );
  } else if (Number.isFinite(props.initialTime) && props.initialTime >= 0) {
    syncCurrentTime(props.initialTime, true);
  }

  await nextFrame();
  if (playerRef.value !== player) return;
  if (pendingLyrics) {
    const startedAt = performance.now();
    player.setLyricLines(pendingLyrics, getCurrentTime() + status.lyricOffsetMs);
    pendingLyrics = null;
    void window.api.lyrics.log(
      "info",
      `[perf] amll switchLines=${Math.round(performance.now() - startedAt)}ms`,
    );
    processLyricLanguage(player);
    await nextFrame();
    if (playerRef.value !== player) return;
  }
  syncCurrentTime(getCurrentTime() + status.lyricOffsetMs, true);
  player.update(0);
  initialized.value = true;
  contentVisible.value = true;
  emit("ready");

  // 抽屉展开动画期间容器高度为 0，排版会把歌词排到可视区外；等一帧后按真实尺寸重排
  await nextFrame();
  if (playerRef.value !== player) return;
  player.calcLayout(LayoutReason.ConfigChange);
  // 布局会重建行元素，上一轮的 lang 与内联字体随之丢失，这里补一次
  processLyricLanguage(player);
  player.update(0);

  // 首行若被排到可视区之外，说明首次布局基于未稳定的容器尺寸，强制按当前进度重算一次
  window.setTimeout(() => {
    const current = playerRef.value;
    const host = wrapperRef.value;
    if (!current || !host) return;
    const height = host.clientHeight;
    const line = host.querySelector<HTMLElement>('[class*="lyricLine"]');
    const offset = line ? new DOMMatrixReadOnly(getComputedStyle(line).transform).m42 : Number.NaN;
    const summary = current.getTimelineSummary();
    void window.api.lyrics.log(
      "info",
      `[perf] amll probe h=${height} offset0=${Math.round(offset)} scrollTo=${summary.scrollToIndex} hot=${summary.highlighted}`,
    );
    if (!Number.isFinite(offset) || Math.abs(offset) > height) {
      // 越界说明首次布局基于未稳定的容器尺寸：先让核心重新测量，再按当前进度重算
      current.onResize();
      current.setCurrentTime(getCurrentTime() + status.lyricOffsetMs, true);
      current.calcLayout(LayoutReason.Seek);
      processLyricLanguage(current);
      current.update(0);
      void window.api.lyrics.log(
        "info",
        `[perf] amll heal offset0=${Math.round(offset)} h=${height}`,
      );
    }
  }, 700);

  // 尺寸变化（窗口缩放、布局切换）同样需要重排
  let lastWidth = wrapperRef.value?.clientWidth ?? 0;
  let lastHeight = wrapperRef.value?.clientHeight ?? 0;
  resizeObserver = new ResizeObserver(() => {
    const current = playerRef.value;
    const host = wrapperRef.value;
    if (!current || !host) return;
    // 尺寸没变就不要重排：重排会把滚动位置直接吸附过去，表现为歌词一跳一跳
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;
    void window.api.lyrics.log("info", `[perf] amll resize h=${height} w=${width}`);
    current.onResize();
    current.calcLayout(LayoutReason.Resize);
    processLyricLanguage(current);
    current.update(0);
  });
  if (wrapperRef.value) {
    resizeObserver.observe(wrapperRef.value);
    // 内核重排会整体重建行节点，监听后统一补一次应用，避免要等交互才生效
    rowObserver?.disconnect();
    rowObserver = new MutationObserver(() => {
      if (rowApplyHandle !== undefined) return;
      rowApplyHandle = requestAnimationFrame(() => {
        rowApplyHandle = undefined;
        processLyricLanguage();
      });
    });
    rowObserver.observe(wrapperRef.value, { childList: true, subtree: true });
  }

  // 观察时间线是否随播放推进：hot 长期为 0 说明核心时钟没有前进
  // 250ms 自检：外部时间推送一旦停住就自己补，避免核心时钟冻结导致歌词不滚动
  tickTimer = window.setInterval(() => {
    const current = playerRef.value;
    if (!current) return;
    if (props.playing && !isFrozen.value && performance.now() - lastSyncAt > 400) {
      syncCurrentTime(getCurrentTime() + status.lyricOffsetMs);
    }
    if (++tickCount % 8 !== 0) return;
    const summary = current.getTimelineSummary();
    void window.api.lyrics.log(
      "info",
      `[perf] amll tick now=${Math.round(getCurrentTime())} scrollTo=${summary.scrollToIndex} hot=${summary.highlighted}`,
    );
  }, 250);
});

onUnmounted(() => {
  document.removeEventListener("visibilitychange", handleVisibility);
  resizeObserver?.disconnect();
  resizeObserver = undefined;
  rowObserver?.disconnect();
  rowObserver = undefined;
  if (rowApplyHandle !== undefined) {
    cancelAnimationFrame(rowApplyHandle);
    rowApplyHandle = undefined;
  }
  if (tickTimer !== undefined) window.clearInterval(tickTimer);
  tickTimer = undefined;
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

  // 首次运行时校准一次（避免重复）
  if (!clockInitialized.value) {
    player.update(0);
    clockInitialized.value = true;
  }

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
    const currentTime = getCurrentTime() + status.lyricOffsetMs;
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
    convertExcessiveBackgroundLines: settings.lyric.amllConvertExcessiveBackgroundLines,
    syncMainAndBackgroundLines: settings.lyric.amllSyncMainAndBackgroundLines,
    normalizeSpaces: settings.lyric.amllNormalizeSpaces,
    resetLineTimestamps: settings.lyric.amllResetLineTimestamps,
  }),
  (options) => {
    if (!playerRef.value) return;
    playerRef.value.setOptimizeOptions(options);
    if (processedLyrics.value.length > 0 && !isFrozen.value) {
      const currentTime = getCurrentTime() + status.lyricOffsetMs;
      playerRef.value.setLyricLines(processedLyrics.value, currentTime);
      syncCurrentTime(currentTime, true);
      processLyricLanguage();
    }
  },
  { deep: true },
);

// 主播放器事件驱动的时间同步接口
const setCurrentTime = (time: number, isSeek?: boolean) => {
  syncCurrentTime(time, isSeek);
};

/**
 * 强制滚动歌词到指定播放时间
 *
 * 切歌与拖动进度时先把弹簧临时调成瞬时，让歌词立刻落到目标位置，
 * 定位完成后再恢复用户设置的弹簧，避免软弹簧把首帧拖成一秒的缓慢滑动
 * @param time - 播放时间（毫秒）
 */
const scrollToTime = (time: number): void => {
  const player = playerRef.value;
  if (!player) return;
  player.setLinePosYSpringParams({ mass: 0.1, damping: 0, stiffness: 1, soft: false });
  syncCurrentTime(time, true);
  requestAnimationFrame(() => requestAnimationFrame(() => syncPlayerOptions(player)));
};

// 隐藏界面或休眠时调用
const freeze = () => {
  isFrozen.value = true;
};

// 恢复播放和滚动测量
const resume = () => {
  if (!initialized.value) {
    isFrozen.value = false;
    return;
  }
  if (pendingLyrics) {
    const currentTime = getCurrentTime() + status.lyricOffsetMs;
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
    <slot name="bottom" />
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
