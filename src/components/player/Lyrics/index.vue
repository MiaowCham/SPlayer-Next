<script setup lang="ts">
import type { LargerLyricText, LyricFloatAnimationIntensity } from "@/types/settings";
import type { LyricLine } from "@shared/types/lyrics";
import { useSettingsStore } from "@/stores/settings";

const props = withDefaults(
  defineProps<{
    /** 歌词行数据数组 */
    lyricLines: LyricLine[];
    /** 挂载时的初始播放时间（毫秒） */
    initialTime?: number;
    /** 是否正在播放 */
    playing?: boolean;
    /** 激活行在容器中的对齐位置 [0 ~ 1] */
    alignPosition?: number;
    /** 逐字遮罩渐变宽度比例 */
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
    /** 是否显示翻译歌词 */
    showTranslation?: boolean;
    /** 是否显示逐行音译 */
    showRomanization?: boolean;
    /** 是否将发音显示在翻译上方 */
    swapTranslationPronunciation?: boolean;
    /** 歌词与发音同时显示时的大字体内容 */
    largerLyricText?: LargerLyricText;
    /** 强制音节分隔补空格 */
    forceSyllableSpacing?: boolean;
  }>(),
  {
    initialTime: 0,
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
    showTranslation: true,
    showRomanization: true,
    swapTranslationPronunciation: false,
    largerLyricText: "lyrics",
    forceSyllableSpacing: false,
  },
);

const emit = defineEmits<{
  (e: "seek", timeMs: number): void;
  (e: "ready"): void;
}>();

const settings = useSettingsStore();

interface LyricEngineInstance {
  setCurrentTime: (time: number, isSeeking?: boolean) => void;
  freeze: () => void;
  resume: () => void;
}

const activeEngineRef = ref<LyricEngineInstance | null>(null);

/** 两个引擎共用同一套接口，按设置切换 */
const AMLLLyrics = defineAsyncComponent(() => import("./AMLLLyrics.vue"));
const LegacyLyrics = defineAsyncComponent(() => import("./LegacyLyrics.vue"));

const isAmllEngine = computed(() => settings.lyric.engine === "amll");

const setCurrentTime = (time: number, isSeeking = false): void => {
  activeEngineRef.value?.setCurrentTime(time, isSeeking);
};

const freeze = (): void => {
  activeEngineRef.value?.freeze();
};

const resume = (): void => {
  activeEngineRef.value?.resume();
};

defineExpose({ setCurrentTime, freeze, resume });
</script>

<template>
  <AMLLLyrics
    v-if="isAmllEngine"
    ref="activeEngineRef"
    :lyric-lines="props.lyricLines"
    :initial-time="props.initialTime"
    :playing="props.playing"
    :align-position="props.alignPosition"
    :word-fade-width="props.wordFadeWidth"
    :hide-passed-lines="props.hidePassedLines"
    :enable-blur="props.enableBlur"
    :enable-word-highlight="props.enableWordHighlight"
    :float-animation-intensity="props.floatAnimationIntensity"
    :enable-emphasize-effect="props.enableEmphasizeEffect"
    :disable-cjk-emphasis="props.disableCjkEmphasis"
    :raise-align-position-on-overlap="props.raiseAlignPositionOnOverlap"
    :show-translation="props.showTranslation"
    :show-line-romanization="props.showRomanization"
    :show-word-romanization="settings.lyric.showWordRomanization"
    :swap-translation-pronunciation="props.swapTranslationPronunciation"
    :larger-lyric-text="props.largerLyricText"
    :force-syllable-spacing="props.forceSyllableSpacing"
    :force-line-pronunciation-as-main="settings.lyric.forceLinePronunciationAsMain"
    :independent-word-romanization-progress="settings.lyric.independentWordRomanizationProgress"
    @seek="emit('seek', $event)"
    @ready="emit('ready')"
  >
    <template #bottom>
      <slot name="bottom" />
    </template>
  </AMLLLyrics>
  <LegacyLyrics
    v-else
    ref="activeEngineRef"
    :lyric-lines="props.lyricLines"
    :initial-time="props.initialTime"
    :playing="props.playing"
    :align-position="props.alignPosition"
    :word-fade-width="props.wordFadeWidth"
    :hide-passed-lines="props.hidePassedLines"
    :enable-blur="props.enableBlur"
    :enable-word-highlight="props.enableWordHighlight"
    :float-animation-intensity="props.floatAnimationIntensity"
    :enable-emphasize-effect="props.enableEmphasizeEffect"
    :disable-cjk-emphasis="props.disableCjkEmphasis"
    :raise-align-position-on-overlap="props.raiseAlignPositionOnOverlap"
    :show-translation="props.showTranslation"
    :show-romanization="props.showRomanization"
    :swap-translation-pronunciation="props.swapTranslationPronunciation"
    :larger-lyric-text="props.largerLyricText"
    :force-syllable-spacing="props.forceSyllableSpacing"
    @seek="emit('seek', $event)"
    @ready="emit('ready')"
  >
    <template #bottom>
      <slot name="bottom" />
    </template>
  </LegacyLyrics>
</template>
