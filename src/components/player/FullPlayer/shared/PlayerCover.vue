<script lang="ts">
const hdCache = shallowRef<{ id: string; data: string } | null>(null);
</script>

<script setup lang="ts">
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import * as queueStore from "@/stores/queue";

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
/** 等待动态封面就绪的时间，超时则退回静态图叠化 */
const MOTION_GRACE_MS = 350;

/** 进入过渡的类：减少动效时缩短时长且不做缩放 */
const enterActiveClass = computed(() =>
  settings.reducedMotion
    ? "transition-opacity duration-200 ease-linear"
    : "transition-opacity duration-900 ease-in",
);

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
/** 等待目标曲目的动态封面就绪 */
const waitForMotion = (id: string, timeout: number): Promise<boolean> =>
  new Promise((resolve) => {
    const key = `${settings.player.motionCoverSource}:${id}`;
    if (motion.value?.key === key) {
      resolve(true);
      return;
    }
    const stop = setInterval(() => {
      if (motion.value?.key === key) {
        clearInterval(stop);
        resolve(true);
      }
    }, 30);
    setTimeout(() => {
      clearInterval(stop);
      resolve(motion.value?.key === key);
    }, timeout);
  });

let pendingLayerTimer: ReturnType<typeof setTimeout> | undefined;
/** 最近一次 AutoMix 交接开始的时间戳，用于判断切歌是否发生在交接窗口内 */
let automixStartedAt = 0;

watch(
  () => status.transitioning,
  (active) => {
    if (active && status.transitionMode === "automix") automixStartedAt = Date.now();
  },
);

watch([coverSrc, () => displayTrack.value?.cover], async () => {
  // AutoMix 交叉淡化期间，文字先更新，封面延迟交接
  const inAutomix =
    (status.transitioning && status.transitionMode === "automix") ||
    Date.now() - automixStartedAt < 4000;
  const delay = inAutomix ? AUTOMIX_COVER_DELAY_MS : 0;
  const layer = createLayer();
  if (pendingLayerTimer) {
    clearTimeout(pendingLayerTimer);
    pendingLayerTimer = undefined;
  }
  if (delay > 0) {
    await new Promise<void>((resolve) => {
      pendingLayerTimer = setTimeout(() => {
        pendingLayerTimer = undefined;
        resolve();
      }, delay);
    });
  }
  // AutoMix 交接时优先让视频单段淡入，命中则不叠加静态图；手动切歌保持原样
  const id = displayTrack.value?.id;
  const preferMotion =
    inAutomix &&
    settings.player.motionCoverSource !== "off" &&
    !!id &&
    (await waitForMotion(id, MOTION_GRACE_MS));
  if (preferMotion) return;
  const decodes = [layer.src, layer.fallback].filter(Boolean).map((src) => {
    const image = new Image();
    image.src = src!;
    return image.decode();
  });
  await Promise.any(decodes).catch(() => {});
  if (layer.id !== layerId) return;
  markTransition();
  layers.value = [layers.value[0], layer];
});

const motion = shallowRef<{ key: string; src: string } | null>(null);
const motionReady = ref(false);
const videoRef = ref<HTMLVideoElement>();

watch(
  () =>
    [
      status.isPlayerExpanded && !status.trackLoading,
      settings.player.motionCoverSource,
      displayTrack.value?.id,
    ] as const,
  async ([active, source, id]) => {
    const key = `${source}:${id}`;
    if (motion.value && motion.value.key !== key) {
      motion.value = null;
      motionReady.value = false;
    }
    if (!active || source === "off" || !id || !displayTrack.value || motion.value) return;
    const src = await window.api.motionCover.resolve(toRaw(displayTrack.value), source);
    if (src && `${settings.player.motionCoverSource}:${displayTrack.value?.id}` === key) {
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
const prefetchedMotion = new Set<string>();

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
    if (source === "off" || !status.isPlaying) return;
    const current = displayTrack.value;
    if (!current || !motion.value) return;
    const remaining = status.duration - status.position;
    if (remaining <= 0 || remaining > 20_000) return;
    const next = queueStore.getTrack(status.playIndex + 1);
    if (!next || next.id === current.id) return;
    const key = `${source}:${next.id}`;
    if (prefetchedMotion.has(key)) return;
    prefetchedMotion.add(key);
    void window.api.motionCover.resolve(toRaw(next), source).catch(() => {});
  },
);

const visibility = useDocumentVisibility();

// 跟随播放暂停，窗口隐藏时停止解码
watch([videoRef, () => status.isPlaying, visibility], ([video, playing, visible]) => {
  if (!video) return;
  if (playing && visible === "visible") video.play().catch(() => {});
  else video.pause();
});

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
  if (pendingLayerTimer) clearTimeout(pendingLayerTimer);
  if (videoRef.value) releaseVideo(videoRef.value);
});
</script>

<template>
  <!-- 外观由布局决定，这里只负责高清封面加载与共享过渡标记 -->
  <div data-player-cover="full" class="relative overflow-hidden shrink-0">
    <!-- 切歌交叉淡入 -->
    <TransitionGroup
      :enter-active-class="enterActiveClass"
      :enter-from-class="'opacity-0'"
      @after-enter="layers = layers.slice(-1)"
    >
      <DetailCover
        v-for="layer in layers"
        :key="layer.id"
        :src="layer.src"
        :fallback="layer.fallback"
        :crossfade="false"
        class="absolute! inset-0 size-full"
        :class="transitioning && '[will-change:opacity]'"
      />
    </TransitionGroup>
    <!-- 动态封面 -->
    <Transition
      leave-active-class="transition-opacity duration-500"
      leave-to-class="opacity-0"
      @after-leave="releaseVideo"
    >
      <video
        v-if="motion && status.isPlayerExpanded"
        ref="videoRef"
        :key="motion.src"
        :src="motion.src"
        muted
        loop
        playsinline
        class="absolute inset-0 z-2 size-full object-cover transition-opacity duration-900 ease-in"
        :class="motionReady ? 'opacity-100' : 'opacity-0'"
        @loadeddata="motionReady = true"
      />
    </Transition>
  </div>
</template>
