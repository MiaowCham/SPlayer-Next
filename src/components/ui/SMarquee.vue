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
  /** 起步加速时长（ms） */
  ramp?: number;
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
  pause: 5500,
  gap: 50,
  ramp: 400,
  fit: false,
  mask: true,
  maskWidth: 12,
});

const settings = useSettingsStore();
const containerRef = ref<HTMLElement>();
const textRef = ref<HTMLElement>();
const trackRef = ref<HTMLElement>();
const isOverflowing = ref(false);
const contentWidth = ref(0);

let resizeObserver: ResizeObserver | null = null;
let animation: Animation | null = null;

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
  animation?.cancel();
  animation = null;
  if (!isOverflowing.value) {
    track.style.transform = "";
    return;
  }
  const distance = contentWidth.value + props.gap;
  if (distance <= 1) return;
  // 起步先加速到匀速：加速段平均速度是匀速的一半
  const rampMs = Math.min(props.ramp, (distance / props.speed) * 500);
  const rampDistance = (props.speed * rampMs) / 2000;
  const scrollMs = rampMs + ((distance - rampDistance) / props.speed) * 1000;
  const total = scrollMs + props.pause;
  const pauseRatio = props.pause / total;
  const rampRatio = rampMs / total;
  animation = track.animate(
    [
      { transform: "translateX(0px)", offset: 0, easing: "linear" },
      { transform: "translateX(0px)", offset: pauseRatio, easing: "ease-in" },
      {
        transform: `translateX(-${rampDistance}px)`,
        offset: pauseRatio + rampRatio,
        easing: "linear",
      },
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
});
</script>

<template>
  <div
    ref="containerRef"
    class="overflow-hidden"
    :class="[fit ? 'max-w-full' : 'w-full', isOverflowing && mask && 's-marquee-mask']"
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
