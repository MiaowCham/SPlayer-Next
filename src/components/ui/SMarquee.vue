<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
export interface SMarqueeProps {
  /** 滚动速度（px/s） */
  speed?: number;
  /** 开始滚动前的延迟（ms） */
  delay?: number;
  /** 两段文本之间的间距（px） */
  gap?: number;
  /** 收缩适应内容 */
  fit?: boolean;
  /** 是否在超出滚动时启用边缘渐变遮罩 */
  mask?: boolean;
  /** 渐变遮罩宽度（px） */
  maskWidth?: number;
}

const settings = useSettingsStore();

const props = withDefaults(defineProps<SMarqueeProps>(), {
  speed: 30,
  delay: 2000,
  gap: 50,
  fit: false,
  mask: true,
  maskWidth: 8,
});

const containerRef = ref<HTMLElement>();
const textRef = ref<HTMLElement>();
const isOverflowing = ref(false);
const animDuration = ref("0s");
const animDistance = ref("100%");

let resizeObserver: ResizeObserver | null = null;

const check = () => {
  const container = containerRef.value;
  if (!container) return;
  // 容器与文本取较大者：任一侧量到 0（字体未就绪/被收缩）时仍能拿到真实内容宽度
  const contentWidth = Math.max(container.scrollWidth, textRef.value?.scrollWidth ?? 0);
  const overflow = settings.appearance.marqueeScroll && contentWidth > container.clientWidth + 1;
  isOverflowing.value = overflow;
  if (overflow) {
    // 兜底下限，避免宽度为 0 时算出 0s 导致动画瞬间跑完、两份内容重叠
    const duration = Math.max(contentWidth / props.speed, 4);
    animDuration.value = `${duration}s`;
    // 位移量按「内容宽 + 间隔」精确计算，避免用 -50% 时因间隔产生的半格偏差
    animDistance.value = `${contentWidth + props.gap}px`;
  }
};

onMounted(() => {
  resizeObserver = new ResizeObserver(check);
  if (containerRef.value) resizeObserver.observe(containerRef.value);
  if (textRef.value) resizeObserver.observe(textRef.value);
  nextTick(check);
  // 布局与字体就绪后再量几次，避免首帧宽度为 0 时算出异常时长
  requestAnimationFrame(check);
  setTimeout(check, 200);
  document.fonts?.ready.then(check).catch(() => {});
});

onUpdated(check);

onUnmounted(() => {
  resizeObserver?.disconnect();
});
</script>

<template>
  <div
    ref="containerRef"
    class="overflow-hidden"
    :class="[fit ? 'max-w-full' : 'w-full', isOverflowing && mask && 's-marquee-mask']"
    :style="{
      '--marquee-duration': animDuration,
      '--marquee-delay': `${delay}ms`,
      '--marquee-gap': `${gap}px`,
      '--marquee-mask-width': `${maskWidth}px`,
      '--marquee-distance': animDistance,
    }"
  >
    <div
      class="inline-flex whitespace-nowrap min-w-full"
      :class="isOverflowing && 's-marquee-scrolling'"
    >
      <span ref="textRef" class="inline-flex items-center whitespace-nowrap shrink-0">
        <slot />
      </span>
      <span
        v-if="isOverflowing"
        class="inline-flex items-center whitespace-nowrap shrink-0 pl-[var(--marquee-gap,50px)]"
        aria-hidden="true"
      >
        <slot />
      </span>
    </div>
  </div>
</template>

<style scoped>
.s-marquee-scrolling {
  will-change: transform;
  animation: s-marquee-scroll var(--marquee-duration, 10s) linear var(--marquee-delay, 2s) infinite;
}
@keyframes s-marquee-scroll {
  0% {
    transform: translateX(0);
  }
  100% {
    transform: translateX(calc(-1 * var(--marquee-distance, 100%)));
  }
}

.s-marquee-mask {
  mask-image: linear-gradient(
    to right,
    black 0%,
    black calc(100% - var(--marquee-mask-width, 8px)),
    transparent 100%
  );
  -webkit-mask-image: linear-gradient(
    to right,
    black 0%,
    black calc(100% - var(--marquee-mask-width, 8px)),
    transparent 100%
  );
  animation: s-marquee-mask-fade var(--marquee-duration, 10s) linear var(--marquee-delay, 2s)
    infinite;
}

@keyframes s-marquee-mask-fade {
  0%,
  100% {
    mask-image: linear-gradient(
      to right,
      transparent 0%,
      black var(--marquee-mask-width, 8px),
      black calc(100% - var(--marquee-mask-width, 8px)),
      transparent 100%
    );
    -webkit-mask-image: linear-gradient(
      to right,
      transparent 0%,
      black var(--marquee-mask-width, 8px),
      black calc(100% - var(--marquee-mask-width, 8px)),
      transparent 100%
    );
  }
}
</style>
