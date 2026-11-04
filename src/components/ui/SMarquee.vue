<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";

export interface SMarqueeProps {
  /** 滚动速度（px/s） */
  speed?: number;
  /** 开始滚动前的延迟（ms） */
  delay?: number;
  /** 一轮滚动结束后在接缝处的停留时间（ms） */
  pause?: number;
  /** 两份内容之间的间隔（px） */
  gap?: number;
  /** 收缩适应内容 */
  fit?: boolean;
  /** 是否在超出滚动时启用边缘渐变遮罩 */
  mask?: boolean;
  /** 渐变遮罩宽度（px） */
  maskWidth?: number;
}

const props = withDefaults(defineProps<SMarqueeProps>(), {
  speed: 45,
  delay: 1000,
  pause: 5500,
  gap: 100,
  fit: false,
  mask: true,
  maskWidth: 12,
});

const settings = useSettingsStore();
const containerRef = ref<HTMLElement>();
const textRef = ref<HTMLElement>();
const trackRef = ref<HTMLElement>();
const isOverflowing = ref(false);
const isScrolling = ref(false);
const contentWidth = ref(0);

let resizeObserver: ResizeObserver | null = null;
let animation: Animation | null = null;
let phaseFrame: number | undefined;
/** 当前动画的参数指纹，参数不变时不重建动画，避免刷新重置进度 */
let animationKey = "";

/**
 * 同步滚动动画
 *
 * 与 Apple Music 一致：内容复制一份并以间隔相隔，匀速从左往右推进一整轮
 * （内容宽 + 间隔），到接缝处停留数秒后继续；由于副本起点与正文起点重合，
 * 停留与循环都看不出接缝
 */
const syncAnimation = (): void => {
  const track = trackRef.value;
  if (!track) return;
  if (!isOverflowing.value) {
    animation?.cancel();
    animation = null;
    animationKey = "";
    stopPhaseTracking();
    track.style.transform = "";
    return;
  }
  const distance = contentWidth.value + props.gap;
  if (distance <= 1) return;
  const key = `${distance}|${props.speed}|${props.pause}|${props.delay}|${props.gap}`;
  if (animation && animationKey === key) return;
  const scrollMs = (distance / props.speed) * 1000;
  const total = scrollMs + props.pause;
  const pauseRatio = props.pause / total;
  // 全程一条缓动曲线：起步略缓、尾段明显减速停住（对齐 Apple 的收尾手感）
  const scrollEasing = "cubic-bezier(0.22, 0, 0.12, 1)";
  animation?.cancel();
  animation = track.animate(
    [
      { transform: "translateX(0px)", offset: 0, easing: "linear" },
      { transform: "translateX(0px)", offset: pauseRatio, easing: scrollEasing },
      { transform: `translateX(-${distance}px)`, offset: 1 },
    ],
    {
      duration: total,
      delay: props.delay,
      iterations: Infinity,
      easing: "linear",
      fill: "both",
    },
  );
  animationKey = key;
  startPhaseTracking(props.delay);
};

/** 跟踪动画相位：滚动段内侧也要渐隐，停留段只保留右侧渐隐 */
const startPhaseTracking = (delay: number): void => {
  stopPhaseTracking();
  const startedAt = performance.now();
  const tick = (): void => {
    const elapsed = performance.now() - startedAt - delay;
    const track = trackRef.value;
    const text = textRef.value;
    if (elapsed < 0 || !track || !text) {
      isScrolling.value = false;
    } else {
      // 读取当前位移：左边缘是否还有被裁切的文字，决定左侧渐隐
      const matrix = getComputedStyle(track).transform;
      const offset = Math.abs(matrix === "none" ? 0 : Number(matrix.split(",")[4] ?? 0));
      const textWidth = text.scrollWidth;
      isScrolling.value = offset > 1 && offset < textWidth - 8;
    }
    phaseFrame = requestAnimationFrame(tick);
  };
  phaseFrame = requestAnimationFrame(tick);
};

/** 停止相位跟踪 */
const stopPhaseTracking = (): void => {
  if (phaseFrame !== undefined) {
    cancelAnimationFrame(phaseFrame);
    phaseFrame = undefined;
  }
  isScrolling.value = false;
};

const check = (): void => {
  const container = containerRef.value;
  const text = textRef.value;
  if (!container || !text) return;
  contentWidth.value = text.scrollWidth;
  const overflow = text.scrollWidth - container.clientWidth;
  isOverflowing.value = settings.appearance.marqueeScroll && overflow > 1;
  nextTick(syncAnimation);
};

onMounted(() => {
  resizeObserver = new ResizeObserver(check);
  if (containerRef.value) resizeObserver.observe(containerRef.value);
  if (textRef.value) resizeObserver.observe(textRef.value);
  nextTick(check);
  requestAnimationFrame(check);
  setTimeout(check, 200);
  document.fonts?.ready.then(check).catch(() => {});
});

onUpdated(check);

watch(() => settings.appearance.marqueeScroll, check);

onUnmounted(() => {
  resizeObserver?.disconnect();
  animation?.cancel();
  stopPhaseTracking();
});
</script>

<template>
  <div
    ref="containerRef"
    class="overflow-hidden"
    :class="[
      fit ? 'max-w-full' : 'w-full',
      isOverflowing && mask && (isScrolling ? 's-marquee-mask-scrolling' : 's-marquee-mask'),
    ]"
    :style="{
      '--marquee-mask-width': `${maskWidth}px`,
      '--marquee-gap': `${gap}px`,
    }"
  >
    <div ref="trackRef" class="inline-flex min-w-full whitespace-nowrap">
      <span ref="textRef" class="inline-flex shrink-0 items-center whitespace-nowrap">
        <slot />
      </span>
      <span
        v-if="isOverflowing"
        class="inline-flex shrink-0 items-center whitespace-nowrap pl-[var(--marquee-gap,50px)]"
        aria-hidden="true"
      >
        <slot />
      </span>
    </div>
  </div>
</template>

<style scoped>
/* 停留段：只有右侧渐隐，文字起点贴左边缘 */
.s-marquee-mask {
  mask-image: linear-gradient(
    to right,
    black 0%,
    black calc(100% - var(--marquee-mask-width, 12px)),
    transparent 100%
  );
  -webkit-mask-image: linear-gradient(
    to right,
    black 0%,
    black calc(100% - var(--marquee-mask-width, 12px)),
    transparent 100%
  );
}

/* 滚动段：两侧都渐隐，滚动中的文字自然淡入淡出 */
.s-marquee-mask-scrolling {
  mask-image: linear-gradient(
    to right,
    transparent 0%,
    black var(--marquee-mask-width, 12px),
    black calc(100% - var(--marquee-mask-width, 12px)),
    transparent 100%
  );
  -webkit-mask-image: linear-gradient(
    to right,
    transparent 0%,
    black var(--marquee-mask-width, 12px),
    black calc(100% - var(--marquee-mask-width, 12px)),
    transparent 100%
  );
}
</style>
