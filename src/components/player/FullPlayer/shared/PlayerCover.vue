<script lang="ts">
const hdCache = shallowRef<{ id: string; data: string } | null>(null);
</script>

<script setup lang="ts">
import type { MotionCoverSource, Track } from "@shared/types/player";
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import * as queueStore from "@/stores/queue";
import * as player from "@/core/player";

const media = useMediaStore();
const status = useStatusStore();
const settings = useSettingsStore();

/** 加载中的歌曲使用队列当前项作为封面兜底 */
const displayTrack = computed(() => media.track ?? status.currentTrack);

const coverSrc = computed(() =>
  hdCache.value && hdCache.value.id === displayTrack.value?.id
    ? hdCache.value.data
    : displayTrack.value?.coverOriginal || displayTrack.value?.cover,
);

watchEffect(async () => {
  const id = displayTrack.value?.id;
  if (!status.isPlayerExpanded || status.trackLoading || !id) return;
  if (displayTrack.value?.source !== "local" || hdCache.value?.id === id) return;
  const r = await window.api.player.getCoverRaw();
  if (displayTrack.value?.id !== id || !r.success || !r.data) return;
  hdCache.value = { id, data: r.data };
});

let layerId = 0;

const createLayer = () => ({
  id: ++layerId,
  src: coverSrc.value,
  fallback: displayTrack.value?.cover,
});

const layers = shallowRef([createLayer()]);
/** 封面正在交叉淡化：这段时间才给合成层提示 */
const transitioning = ref(false);
let transitionTimer: ReturnType<typeof setTimeout> | undefined;

/** AutoMix 时封面比文字晚切换的时长，对齐 Apple 的交接顺序 */
const AUTOMIX_COVER_DELAY_MS = 1200;

/** 叠化时长：减少动效时缩短 */
const fadeDuration = computed(() => (settings.reducedMotion ? 200 : 900));

/** 图层进入：显式用 WAAPI 淡入，避免主线程繁忙时 CSS 类时序被跳过 */
/**
 * 通过显式动画让已解码的新封面淡入
 * @param el - 进入的封面层
 * @param done - 通知 Vue 动画结束
 */
const onLayerEnter = (el: Element, done: () => void): void => {
  const animation = (el as HTMLElement).animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: fadeDuration.value,
    easing: "ease-in",
    fill: "both",
  });
  animation.onfinish = () => {
    animation.cancel();
    done();
  };
};

/**
 * 移除已被淡入封面盖住的旧图层
 * @param el - 完成淡入的封面层
 */
const onLayerReady = (el: Element): void => {
  if (el.getAttribute("data-layer-id") === String(layers.value.at(-1)?.id)) {
    layers.value = layers.value.slice(-1);
  }
};

/** 标记进入过渡，约 520ms 后撤销 */
const markTransition = (): void => {
  transitioning.value = true;
  if (transitionTimer) clearTimeout(transitionTimer);
  transitionTimer = setTimeout(() => {
    transitioning.value = false;
    transitionTimer = undefined;
  }, 520);
};

/** 预取下一首封面，切歌时可直接命中解码缓存 */
watch(
  () => {
    const next = queueStore.getTrack(status.playIndex + 1);
    return next ? next.coverOriginal || next.cover : null;
  },
  (src) => {
    if (!src) return;
    const image = new Image();
    image.decoding = "async";
    image.src = src;
    void image.decode().catch(() => {});
  },
  { immediate: true },
);

// 新图解码后才淡入，淡入结束前底层旧图保持不动，最多两层
/** 最近一次 AutoMix 交接开始的时间戳，用于判断切歌是否发生在交接窗口内 */
let automixStartedAt = 0;

watch(
  () => status.transitioning,
  (active) => {
    if (active && status.transitionMode === "automix") automixStartedAt = Date.now();
  },
);

watch([coverSrc, () => displayTrack.value?.cover], (_covers, _previous, onCleanup) => {
  // AutoMix 交叉淡化期间，文字先更新，封面延迟交接
  const inAutomix =
    !player.isManualSwitchRecent() &&
    ((status.transitioning && status.transitionMode === "automix") ||
      Date.now() - automixStartedAt < 4000);
  const layer = createLayer();
  let canceled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    canceled = true;
    clearTimeout(timer);
  });

  /** 等新图解码后才允许替换当前图层 */
  const showLayer = async (): Promise<void> => {
    const decodes = [layer.src, layer.fallback].filter(Boolean).map((src) => {
      const image = new Image();
      image.src = src!;
      return image.decode();
    });
    await Promise.any(decodes).catch(() => {});
    if (canceled) return;
    markTransition();
    layers.value = [layers.value[layers.value.length - 1], layer];
  };
  if (inAutomix) timer = setTimeout(() => void showLayer(), AUTOMIX_COVER_DELAY_MS);
  else void showLayer();
});

/**
 * 关联动态封面结果与曲目身份，避免跨平台或跨服务器同 ID 错配
 * @param track - 动态封面所属曲目
 * @param source - 动态封面设置
 * @returns 动态封面请求键
 */
const motionKey = (track: Track | null | undefined, source: MotionCoverSource): string =>
  JSON.stringify([source, track?.source, track?.serverId, track?.serverRevision, track?.id]);

const motion = shallowRef<{ key: string; src: string } | null>(null);
const motionReady = ref(false);

// 视频地址变化时重置就绪状态，让新视频重新淡入（动态切动态也有叠化）
watch(
  () => motion.value?.src,
  () => {
    motionReady.value = false;
  },
);
const videoRef = ref<HTMLVideoElement>();
let motionClearTimer: ReturnType<typeof setTimeout> | undefined;
const visibility = useDocumentVisibility();

watch(
  () =>
    [
      status.isPlayerExpanded && !status.trackLoading,
      settings.player.motionCoverSource,
      displayTrack.value,
    ] as const,
  async ([active, source, track], _previous, onCleanup) => {
    const key = motionKey(track, source);
    let canceled = false;
    onCleanup(() => {
      canceled = true;
      clearTimeout(motionClearTimer);
    });
    if (motion.value && motion.value.key !== key) {
      const manual = player.isManualSwitchRecent();
      if (manual) {
        // 冻结在最后一帧，作为与静态封面叠化的底图
        videoRef.value?.pause();
      }
      // 手动切歌立即开始淡出；自动交接保留 400ms 搭接
      const delay = manual ? 0 : 400;
      if (motionClearTimer) clearTimeout(motionClearTimer);
      motionClearTimer = setTimeout(() => {
        motionClearTimer = undefined;
        if (motion.value && motion.value.key !== key) {
          motion.value = null;
          motionReady.value = false;
        }
      }, delay);
    }
    if (!active || source === "off" || !track || motion.value?.key === key) return;
    const src = await window.api.motionCover.resolve(toRaw(track), source).catch(() => null);
    if (!canceled && src) {
      clearTimeout(motionClearTimer);
      motionReady.value = false;
      motion.value = { key, src };
    }
  },
  { immediate: true },
);

// 动态封面已接管显示，底层只留一张图兜底
watch(motionReady, (ready) => {
  if (ready && layers.value.length > 1) layers.value = layers.value.slice(-1);
});

/** 已预取过动态封面的曲目，避免重复请求 */
let prefetchedMotion: string | undefined;

/**
 * AutoMix 临近交接时预取下一首的动态封面
 *
 * 只在这一首自己的动态封面已就绪后触发，避免打断当前曲目的解析
 */
watch(
  () => [status.position, status.duration, displayTrack.value?.id] as const,
  () => {
    if (settings.player.transitionMode !== "automix") return;
    const source = settings.player.motionCoverSource;
    if (source === "off" || !status.isPlaying || !status.isPlayerExpanded) return;
    const current = displayTrack.value;
    if (!current || motion.value?.key !== motionKey(current, source)) return;
    const remaining = status.duration - status.position;
    if (remaining <= 0 || remaining > 20_000) return;
    const next = queueStore.getTrack(status.playIndex + 1);
    if (!next) return;
    const key = motionKey(next, source);
    if (key === motion.value.key || prefetchedMotion === key) return;
    prefetchedMotion = key;
    void window.api.motionCover.resolve(toRaw(next), source).catch(() => {});
  },
);

// 跟随播放暂停，窗口隐藏时停止解码
watch([videoRef, () => status.isPlaying, visibility], ([video, playing, visible]) => {
  if (!video) return;
  if (playing && visible === "visible") video.play().catch(() => {});
  else video.pause();
});

/** 视频离场：淡出后再释放 */
const onVideoLeave = (el: Element, done: () => void): void => {
  const animation = (el as HTMLElement).animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: fadeDuration.value,
    easing: "ease-in",
    fill: "both",
  });
  animation.onfinish = () => {
    animation.cancel();
    done();
  };
};

/** 视频首帧就绪：先置零再淡入，动态切动态也有叠化 */
const onVideoReady = (): void => {
  motionReady.value = true;
  const el = videoRef.value;
  if (!el) return;
  el.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: fadeDuration.value,
    easing: "ease-in",
    fill: "both",
  });
};

/**
 * 移除后立即释放解码器与缓冲，不等 GC
 * @param el - 离场的视频元素
 */
const releaseVideo = (el: Element) => {
  const video = el as HTMLVideoElement;
  video.removeAttribute("src");
  video.load();
};

// 切换布局时组件直接卸载，不经过离场过渡
onBeforeUnmount(() => {
  if (transitionTimer) clearTimeout(transitionTimer);
  if (motionClearTimer) clearTimeout(motionClearTimer);
  if (videoRef.value) releaseVideo(videoRef.value);
});
</script>

<template>
  <!-- 外观由布局决定，这里只负责高清封面加载与共享过渡标记 -->
  <div data-player-cover="full" class="relative overflow-hidden shrink-0">
    <!-- 切歌交叉淡入 -->
    <TransitionGroup :css="false" @enter="onLayerEnter" @after-enter="onLayerReady">
      <DetailCover
        v-for="layer in layers"
        :key="layer.id"
        :data-layer-id="layer.id"
        :src="layer.src"
        :fallback="layer.fallback"
        :crossfade="false"
        class="absolute! inset-0 size-full"
        :class="transitioning && '[will-change:opacity]'"
      />
    </TransitionGroup>
    <!-- 动态封面 -->
    <Transition :css="false" @leave="onVideoLeave" @after-leave="releaseVideo">
      <video
        v-if="motion && status.isPlayerExpanded"
        ref="videoRef"
        :key="motion.src"
        :src="motion.src"
        muted
        loop
        playsinline
        class="absolute inset-0 z-2 size-full object-cover"
        :style="{ opacity: motionReady ? 1 : 0 }"
        @loadeddata="onVideoReady"
      />
    </Transition>
  </div>
</template>
