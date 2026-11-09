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
  pause: 5000,
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
const leftFadeWidth = ref(0);
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
  animation?.cancel();
  animation = track.animate(buildKeyframes(distance, pauseRatio), {
    duration: total,
    delay: props.delay,
    iterations: Infinity,
    easing: "linear",
    fill: "both",
  });
  animationKey = key;
  startPhaseTracking(props.delay);
};

/** 录屏实测速度曲线（归一化），用于生成位移关键帧 */
const SPEED_PROFILE = [
  0, 0.13, 0.78, 0.85, 0.89, 0.98, 0.98, 0.97, 1, 1, 0.96, 0.96, 0.88, 0.84, 0.76, 0.69, 0.59, 0.53,
  0.45, 0.39, 0.31, 0.22, 0.15, 0.07, 0.02, 0,
];

/** 把速度曲线积分成归一化位移，供关键帧使用 */
const buildTravelSteps = (): number[] => {
  const cumulative: number[] = [];
  let sum = 0;
  for (const speed of SPEED_PROFILE) {
    sum += speed;
    cumulative.push(sum);
  }
  const total = sum || 1;
  return cumulative.map((value) => value / total);
};

/** 位移关键帧：加速段 + 匀速段 + 长减速段，全部线性插值 */
const buildKeyframes = (distance: number, pauseRatio: number): Keyframe[] => {
  const steps = buildTravelSteps();
  const frames: Keyframe[] = [
    { transform: "translateX(0px)", offset: 0, easing: "linear" },
    { transform: "translateX(0px)", offset: pauseRatio, easing: "linear" },
  ];
  for (let i = 1; i < steps.length; i += 1) {
    frames.push({
      transform: `translateX(-${steps[i] * distance}px)`,
      offset: pauseRatio + (i / (steps.length - 1)) * (1 - pauseRatio),
      easing: "linear",
    });
  }
  return frames;
};

/** 跟踪动画相位：滚动段内侧也要渐隐，停留段只保留右侧渐隐 */
const startPhaseTracking = (delay: number): void => {
  stopPhaseTracking();
  const startedAt = performance.now();
  let lastFrameAt = performance.now();
  const tick = (): void => {
    const now = performance.now();
    const elapsed = now - startedAt - delay;
    const delta = Math.min(now - lastFrameAt, 64);
    lastFrameAt = now;
    const track = trackRef.value;
    const text = textRef.value;
    let target = 0;
    if (elapsed >= 0 && track && text) {
      // 读取当前位移：左边缘是否还有被裁切的文字，决定左侧渐隐
      const matrix = getComputedStyle(track).transform;
      const offset = Math.abs(matrix === "none" ? 0 : Number(matrix.split(",")[4] ?? 0));
      const textWidth = text.scrollWidth;
      if (offset > 1 && offset < textWidth - 8) target = props.maskWidth;
    }
    // 按时间插值，约 180ms 完成淡入淡出，避免切换时边缘突然变硬
    const step = delta / 240;
    leftFadeWidth.value += (target - leftFadeWidth.value) * Math.min(step, 1);
    if (Math.abs(target - leftFadeWidth.value) < 0.2) leftFadeWidth.value = target;
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
  leftFadeWidth.value = 0;
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
    :class="[fit ? 'max-w-full' : 'w-full', isOverflowing && mask && 's-marquee-mask']"
    :style="{
      '--marquee-mask-width': `${maskWidth}px`,
      '--marquee-left-mask-width': `${leftFadeWidth}px`,
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
/* 左宽度由脚本逐帧插值，右侧固定；两者相加即为两侧渐隐 */
.s-marquee-mask {
  mask-image: linear-gradient(
    to right,
    transparent 0%,
    black var(--marquee-left-mask-width, 0px),
    black calc(100% - var(--marquee-mask-width, 12px)),
    transparent 100%
  );
  -webkit-mask-image: linear-gradient(
    to right,
    transparent 0%,
    black var(--marquee-left-mask-width, 0px),
    black calc(100% - var(--marquee-mask-width, 12px)),
    transparent 100%
  );
}
</style>
