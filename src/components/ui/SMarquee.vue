<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";

export interface SMarqueeProps {
  /** 滚动速度（px/s） */
  speed?: number;
  /** 开始滚动前的延迟（ms） */
  delay?: number;
  /** 滚动结束回到起点后的停留时间（ms） */
  pause?: number;
  /** 收缩适应内容 */
  fit?: boolean;
  /** 是否在超出滚动时启用边缘渐变遮罩 */
  mask?: boolean;
  /** 渐变遮罩宽度（px） */
  maskWidth?: number;
}

const props = withDefaults(defineProps<SMarqueeProps>(), {
  speed: 80,
  delay: 1000,
  pause: 5000,
  fit: false,
  mask: true,
  maskWidth: 12,
});

const settings = useSettingsStore();
const containerRef = ref<HTMLElement>();
const textRef = ref<HTMLElement>();
const trackRef = ref<HTMLElement>();
const isOverflowing = ref(false);

let resizeObserver: ResizeObserver | null = null;
let animation: Animation | null = null;

/** 按当前宽度同步滚动动画（Apple 风格：滚到底即时回到起点，停留后重播） */
const syncAnimation = (): void => {
  const track = trackRef.value;
  if (!track) return;
  animation?.cancel();
  animation = null;
  if (!isOverflowing.value) {
    track.style.transform = "";
    return;
  }
  const container = containerRef.value;
  const text = textRef.value;
  if (!container || !text) return;
  const overflow = Math.max(text.scrollWidth - container.clientWidth, 0);
  if (overflow <= 1) {
    track.style.transform = "";
    return;
  }
  const scrollMs = (overflow / props.speed) * 1000;
  const total = scrollMs + props.pause;
  const pauseRatio = props.pause / total;
  animation = track.animate(
    [
      { transform: "translateX(0px)", offset: 0 },
      { transform: "translateX(0px)", offset: pauseRatio },
      { transform: `translateX(-${overflow}px)`, offset: 1 },
    ],
    {
      duration: total,
      delay: props.delay,
      iterations: Infinity,
      easing: "linear",
      fill: "both",
    },
  );
};

const check = (): void => {
  const container = containerRef.value;
  const text = textRef.value;
  if (!container || !text) return;
  const overflow = text.scrollWidth - container.clientWidth;
  isOverflowing.value = settings.appearance.marqueeScroll && overflow > 1;
  syncAnimation();
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
});
</script>

<template>
  <div
    ref="containerRef"
    class="overflow-hidden"
    :class="[fit ? 'max-w-full' : 'w-full', isOverflowing && mask && 's-marquee-mask']"
    :style="{
      '--marquee-mask-width': `${maskWidth}px`,
    }"
  >
    <div ref="trackRef" class="inline-flex min-w-full whitespace-nowrap">
      <span ref="textRef" class="inline-flex shrink-0 items-center whitespace-nowrap">
        <slot />
      </span>
    </div>
  </div>
</template>

<style scoped>
.s-marquee-mask {
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
