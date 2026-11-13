<script setup lang="ts">
import { getPresentationTime } from "@shared/utils/presentationTime";
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
const { lyricMounted, contentActive, lyricDragTime, onLyricReady } = useFullPlayer();

const lyricRef = ref<InstanceType<typeof Lyrics>>();
const initialLyricTimeMs = ref(0);
const hasLyric = computed(() => media.parsedLyric.length > 0 || media.lyricLoading);
const active = computed(() => lyricMounted.value && contentActive.value && props.visible);
const followingDrag = computed(
  () => settings.player.followLyricOnProgressDrag && lyricDragTime.value !== null,
);

/**
 * 将源时间换算为补偿设备延迟后的歌词时间
 * @param time - 播放或拖动预览时间
 * @returns 歌词展示时间
 */
const lyricTimeMs = (time = getCurrentTime()): number =>
  getPresentationTime(time, status.lyricOffsetMs, status.deviceLatencyMs, status.speed);

const { start: startTick, stop: stopTick } = usePlaybackTime((currentMs) => {
  if (status.trackLoading || media.lyricLoading) return;
  const dragTime = followingDrag.value ? lyricDragTime.value : null;
  lyricRef.value?.setCurrentTime(
    lyricTimeMs(dragTime ?? currentMs),
    dragTime !== null || (status.isPlaying && player.isSeeking()),
  );
});

/** 将歌词重新定位到补偿后的当前播放位置 */
const locateCurrentLyric = (): void => {
  if (!active.value || media.lyricLoading || !media.parsedLyric.length) return;
  lyricRef.value?.scrollToTime(lyricTimeMs());
};

defineExpose({ locateCurrentLyric });

/** 仅在歌词实际可见时推送时间并运行渲染器 */
const syncActivity = (): void => {
  if (active.value) {
    lyricRef.value?.setCurrentTime(lyricTimeMs());
    lyricRef.value?.resume();
    startTick();
  } else {
    stopTick();
    lyricRef.value?.freeze();
  }
};

watch(active, syncActivity, { flush: "post" });

/** 引擎完成首次布局后同步运行状态并通知壳层 */
const onReady = (): void => {
  syncActivity();
  locateCurrentLyric();
  onLyricReady();
};

// 无歌词时不挂载引擎，直接允许壳层安排可视化初始化
watch(
  [lyricMounted, hasLyric],
  ([mounted, hasContent]) => {
    if (!mounted) return;
    initialLyricTimeMs.value = lyricTimeMs();
    if (!hasContent || !props.visible) onLyricReady();
  },
  { immediate: true },
);

watch(
  [
    () => media.parsedLyric,
    () => settings.lyric.largerLyricText,
    () => settings.lyric.forceSyllableSpacing,
    () => settings.lyric.forceLinePronunciationAsMain,
    () => settings.lyric.independentWordRomanizationProgress,
  ],
  locateCurrentLyric,
  { flush: "post" },
);

// 切换歌词引擎时刷新初始时间，待引擎就绪后再恢复渲染
watch(
  () => settings.lyric.engine,
  () => {
    initialLyricTimeMs.value = lyricTimeMs();
  },
);

/**
 * 跳到用户点击的歌词行并恢复播放
 * @param timeMs - 歌词行的源时间
 */
const handleLyricSeek = async (timeMs: number): Promise<void> => {
  await player.seek(timeMs);
  if (!status.isPlaying) await player.play();
};

const lyricFontSize = computed(() =>
  settings.lyric.adaptiveFontSize
    ? `calc(${settings.lyric.fontSize} / 1080 * 100vh)`
    : `${settings.lyric.fontSize}px`,
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
        :minimize-spring-params="followingDrag"
        @seek="handleLyricSeek"
        @ready="onReady"
      />
      <div
        v-else-if="lyricMounted"
        class="w-full h-full flex items-center justify-center text-cover/30"
      >
        {{ $t("player.lyricMatch.noLyric") }}
      </div>
    </div>
  </div>
</template>

<style scoped>
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
