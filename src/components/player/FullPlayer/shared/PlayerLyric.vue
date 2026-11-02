<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { usePlaybackTime } from "@/composables/usePlaybackTime";
import { getCurrentTime } from "@/services/playback";
import Lyrics from "@/components/player/Lyrics/index.vue";
import * as player from "@/core/player";
import { useFullPlayer } from "../context";

const props = defineProps<{
  /** 当前布局下歌词区域是否可见 */
  visible: boolean;
}>();

const status = useStatusStore();
const media = useMediaStore();
const settings = useSettingsStore();
const { lyricMounted, contentActive, onLyricReady } = useFullPlayer();

const lyricRef = ref<InstanceType<typeof Lyrics>>();
const initialLyricTimeMs = ref(0);
const hasLyric = computed(() => media.parsedLyric.length > 0 || media.lyricLoading);

/**
 * 读取叠加单曲偏移后的歌词时间
 * @returns 歌词时间（毫秒）
 */
const lyricTimeMs = (): number => getCurrentTime() + status.lyricOffsetMs;

const { start: startTick, stop: stopTick } = usePlaybackTime((currentMs) => {
  if (!status.trackLoading && !media.lyricLoading) {
    lyricRef.value?.setCurrentTime(currentMs + status.lyricOffsetMs);
  }
});

/** 仅在歌词实际可见时推送时间并运行渲染器 */
const syncActivity = (): void => {
  if (lyricMounted.value && contentActive.value && props.visible) {
    lyricRef.value?.setCurrentTime(lyricTimeMs());
    lyricRef.value?.resume();
    startTick();
  } else {
    stopTick();
    lyricRef.value?.freeze();
  }
};

watch([lyricMounted, contentActive, () => props.visible], syncActivity, { flush: "post" });

/** 引擎完成首次布局后同步运行状态并通知壳层 */
const onReady = (): void => {
  syncActivity();
  onLyricReady();
};

// 挂载前记录初始时间；布局切换重建时同样生效。无歌词时引擎不会挂载，直接按就绪处理
watch(
  lyricMounted,
  (mounted) => {
    if (!mounted) return;
    initialLyricTimeMs.value = lyricTimeMs();
    if (!hasLyric.value) onLyricReady();
  },
  { immediate: true },
);

watch(hasLyric, (value) => {
  if (!lyricMounted.value) return;
  if (value) {
    initialLyricTimeMs.value = lyricTimeMs();
    return;
  }
  onLyricReady();
});

// 歌词变化时先推送精确时间
watch(
  () => media.parsedLyric,
  () => lyricRef.value?.setCurrentTime(lyricTimeMs()),
);

// 切换歌词引擎时，重新计算初始并推送时间
watch(
  () => settings.lyric.engine,
  () => {
    initialLyricTimeMs.value = lyricTimeMs();
    nextTick(syncActivity);
  },
);

const handleLyricSeek = async (timeMs: number): Promise<void> => {
  await player.seek(timeMs);
  if (!status.isPlaying) await player.play();
};

/** 歌词模糊：暂停或拖动进度时按设置临时关闭 */
const effectiveEnableBlur = computed(
  () => settings.lyric.enableBlur && !(settings.lyric.pauseClearBlur && !status.isPlaying),
);

/** 歌词滚动弹簧参数 */
const springConfig = computed(() => ({
  mass: settings.lyric.springMass,
  damping: settings.lyric.springDamping,
  stiffness: settings.lyric.springStiffness,
}));

const lyricFontSize = computed(() =>
  settings.lyric.adaptiveFontSize
    ? `calc(${settings.lyric.fontSize} / 1080 * 100vh)`
    : `${settings.lyric.fontSize}px`,
);

const isChineseLocale = computed(() => settings.locale.startsWith("zh"));

/** 创作者名单按中英文环境选择顿号或逗号连接 */
const lyricCreatorsText = computed(() =>
  media.lyricAuthors.join(isChineseLocale.value ? "、" : ", "),
);

/** 作者前缀与名单之间的分隔符 */
const lyricCreditSeparator = computed(() => (isChineseLocale.value ? "：" : ": "));

/** 按作者类别选择前缀文案 */
const lyricCreditKey = computed(() =>
  media.lyricAuthorKind === "lyric-production"
    ? "player.lyricProduction"
    : media.lyricAuthorKind === "song-production"
      ? "player.songProduction"
      : "player.lyricCreator",
);

const lyricSubFontSize = computed(() => {
  if (settings.lyric.translationFontSizeFollowMain) return "max(0.5em, 12px)";
  return settings.lyric.adaptiveFontSize
    ? `max(12px, calc(${settings.lyric.translationFontSize} / 1080 * 100vh))`
    : `${settings.lyric.translationFontSize}px`;
});
</script>

<template>
  <!-- 字号设在外层，让布局插入的头部信息与歌词同比缩放 -->
  <div class="relative flex-1 min-h-0 flex flex-col" :style="{ fontSize: lyricFontSize }">
    <slot name="header" />
    <div
      data-player-layout="lyric"
      class="lyric-area relative flex-1 min-h-0"
      :style="{
        '--lp-credit-opacity': '1',
        '--lp-sub-font-size': lyricSubFontSize,
        fontWeight: String(settings.lyric.fontWeight),
        fontFamily: settings.lyric.fontFamily || undefined,
        '--lyric-font-zh': settings.lyric.fontFamilyChinese || undefined,
        '--lyric-font-ja': settings.lyric.fontFamilyJapanese || undefined,
        '--lyric-font-ko': settings.lyric.fontFamilyKorean || undefined,
        '--lyric-font-latin': settings.lyric.fontFamilyLatin || undefined,
        mixBlendMode: settings.lyric.lyricBlendMode,
      }"
    >
      <Lyrics
        v-if="lyricMounted && hasLyric"
        ref="lyricRef"
        :lyric-lines="media.parsedLyric"
        :initial-time="initialLyricTimeMs"
        :playing="status.isPlaying"
        :align-position="settings.lyric.alignPosition"
        :word-fade-width="settings.lyric.wordFadeWidth"
        :spring-config="springConfig"
        :inactive-alpha="settings.lyric.inactiveAlpha"
        :hide-passed-lines="settings.lyric.hidePassedLines"
        :enable-blur="effectiveEnableBlur"
        :enable-word-highlight="settings.lyric.enableWordHighlight"
        :float-animation-intensity="settings.lyric.floatAnimationIntensity"
        :enable-emphasize-effect="settings.lyric.enableEmphasizeEffect"
        :disable-cjk-emphasis="settings.lyric.disableCjkEmphasis"
        :raise-align-position-on-overlap="settings.lyric.raiseAlignPositionOnOverlap"
        :show-translation="settings.lyric.showTranslation"
        :show-romanization="settings.lyric.showRomanization"
        :swap-translation-pronunciation="settings.lyric.swapTranslationPronunciation"
        :larger-lyric-text="settings.lyric.largerLyricText"
        :force-syllable-spacing="settings.lyric.forceSyllableSpacing"
        @seek="handleLyricSeek"
        @ready="onReady"
      >
        <template #bottom>
          <div v-if="media.lyricAuthors.length > 0" class="lyric-credit-line">
            <strong class="lyric-credit-prefix">{{ $t(lyricCreditKey) }}</strong>
            <span class="lyric-credit-separator">{{ lyricCreditSeparator }}</span>
            <span class="lyric-credit-content">{{ lyricCreatorsText }}</span>
          </div>
        </template>
      </Lyrics>
      <div
        v-else-if="lyricMounted"
        class="w-full h-full flex items-center justify-center text-cover/30"
      >
        暂无歌词
      </div>
    </div>
  </div>
</template>

<style scoped>
.lyric-credit-line {
  font-size: max(0.5em, 10px);
  display: block;
  text-align: left;
  width: 100%;
  pointer-events: none;
  overflow-wrap: anywhere;
}

.lyric-credit-content {
  cursor: default;
  font-weight: 400 !important;
}

.lyric-area {
  filter: drop-shadow(0px 4px 6px rgba(0, 0, 0, 0.2));
  mask: linear-gradient(
    180deg,
    hsla(0, 0%, 100%, 0) 0,
    hsla(0, 0%, 100%, 0.6) 5%,
    #fff 10%,
    #fff 75%,
    hsla(0, 0%, 100%, 0.6) 85%,
    hsla(0, 0%, 100%, 0)
  );
}
</style>
