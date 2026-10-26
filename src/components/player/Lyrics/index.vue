<script setup lang="ts">
import type { LyricLine } from "@shared/types/lyrics";

import { useSettingsStore } from "@/stores/settings";

const props = withDefaults(
  defineProps<{
    /** 歌词行数据数组 */
    lyricLines: LyricLine[];
    /** 初始播放时间（毫秒） */
    initialTime?: number;
    /** 是否正在播放 */
    playing?: boolean;
    /** 拖动进度时使用较短的弹簧过渡 */
    minimizeSpringParams?: boolean;
  }>(),
  {
    initialTime: 0,
    playing: false,
    minimizeSpringParams: false,
  },
);

const emit = defineEmits<{
  (e: "seek", timeMs: number): void;
  (e: "ready"): void;
}>();

const settings = useSettingsStore();

type LyricEngineInstance = {
  setCurrentTime: (time: number, isSeeking?: boolean) => void;
  scrollToTime: (time: number) => void;
  freeze: () => void;
  resume: () => void;
};

const activeEngineRef = ref<LyricEngineInstance | null>(null);

/** 歌词引擎按需加载 */
const AMLLLyrics = defineAsyncComponent(() => import("./AMLLLyrics.vue"));
const DefaultLyrics = defineAsyncComponent(() => import("./DefaultLyrics.vue"));

const springConfig = computed(() =>
  props.minimizeSpringParams
    ? { mass: 0.1, damping: 1, stiffness: 10 }
    : {
        mass: settings.lyric.springMass,
        damping: settings.lyric.springDamping,
        stiffness: settings.lyric.springStiffness,
      },
);

const setCurrentTime = (time: number, isSeeking = false) => {
  activeEngineRef.value?.setCurrentTime(time, isSeeking);
};

/** 强制定位当前引擎
 * @param time - 播放时间（毫秒）
 */
const scrollToTime = (time: number): void => activeEngineRef.value?.scrollToTime(time);

const freeze = () => {
  activeEngineRef.value?.freeze();
};

const resume = () => {
  activeEngineRef.value?.resume();
};

defineExpose({
  setCurrentTime,
  scrollToTime,
  freeze,
  resume,
});
</script>

<template>
  <AMLLLyrics
    v-if="settings.lyric.engine === 'amll'"
    ref="activeEngineRef"
    :lyric-lines="props.lyricLines"
    :initial-time="props.initialTime"
    :playing="props.playing"
    :align-position="settings.lyric.alignPosition"
    :word-fade-width="settings.lyric.wordFadeWidth"
    :hide-passed-lines="settings.lyric.hidePassedLines"
    :enable-blur="
      settings.lyric.enableBlur &&
      !props.minimizeSpringParams &&
      !(settings.lyric.pauseClearBlur && !props.playing)
    "
    :enable-word-highlight="settings.lyric.enableWordHighlight"
    :float-animation-intensity="settings.lyric.floatAnimationIntensity"
    :enable-emphasize-effect="settings.lyric.enableEmphasizeEffect"
    :minimize-spring-params="props.minimizeSpringParams"
    :independent-word-romanization-progress="settings.lyric.independentWordRomanizationProgress"
    :show-translation="settings.lyric.showTranslation"
    :show-ruby="settings.lyric.showRuby"
    :show-romanization="settings.lyric.showRomanization"
    :show-word-romanization="settings.lyric.showWordRomanization"
    :disable-cjk-emphasis="settings.lyric.disableCjkEmphasis"
    :raise-align-position-on-overlap="settings.lyric.raiseAlignPositionOnOverlap"
    :swap-translation-pronunciation="settings.lyric.swapTranslationPronunciation"
    :larger-lyric-text="settings.lyric.largerLyricText"
    :force-syllable-spacing="settings.lyric.forceSyllableSpacing"
    :force-line-pronunciation-as-main="settings.lyric.forceLinePronunciationAsMain"
    :bg-always-below="settings.lyric.bgAlwaysBelow"
    @seek="emit('seek', $event)"
    @ready="emit('ready')"
  >
    <template #bottom>
      <slot name="bottom">
        <LyricCredit />
      </slot>
    </template>
  </AMLLLyrics>
  <DefaultLyrics
    v-else
    ref="activeEngineRef"
    :lyric-lines="props.lyricLines"
    :initial-time="props.initialTime"
    :playing="props.playing"
    :align-position="settings.lyric.alignPosition"
    :word-fade-width="settings.lyric.wordFadeWidth"
    :spring-config="springConfig"
    :alignment="settings.lyric.alignment"
    :inactive-alpha="settings.lyric.inactiveAlpha"
    :hide-passed-lines="settings.lyric.hidePassedLines"
    :enable-blur="
      settings.lyric.enableBlur &&
      !props.minimizeSpringParams &&
      !(settings.lyric.pauseClearBlur && !props.playing)
    "
    :enable-word-highlight="settings.lyric.enableWordHighlight"
    :float-animation-intensity="settings.lyric.floatAnimationIntensity"
    :enable-emphasize-effect="settings.lyric.enableEmphasizeEffect"
    :enable-scale="settings.lyric.enableScale"
    :disable-cjk-emphasis="settings.lyric.disableCjkEmphasis"
    :raise-align-position-on-overlap="settings.lyric.raiseAlignPositionOnOverlap"
    :swap-translation-pronunciation="settings.lyric.swapTranslationPronunciation"
    :larger-lyric-text="settings.lyric.largerLyricText"
    :force-syllable-spacing="settings.lyric.forceSyllableSpacing"
    :force-line-pronunciation-as-main="settings.lyric.forceLinePronunciationAsMain"
    :bg-always-below="settings.lyric.bgAlwaysBelow"
    :show-translation="settings.lyric.showTranslation"
    :show-ruby="settings.lyric.showRuby"
    :show-romanization="settings.lyric.showRomanization"
    :show-word-romanization="settings.lyric.showWordRomanization"
    @seek="emit('seek', $event)"
    @ready="emit('ready')"
  >
    <template #bottom>
      <slot name="bottom">
        <LyricCredit />
      </slot>
    </template>
  </DefaultLyrics>
</template>
