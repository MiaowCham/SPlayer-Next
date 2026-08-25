<script setup lang="ts">
import { acquireFft, releaseFft } from "@/services/fftCapture";
import { getFftFrame } from "@/services/playback";
import type { AppleMusicBackgroundVariant } from "@/types/settings";
import {
  createAppleMusicBackgroundAudioAnalyzer,
  createAppleMusicBackgroundRenderer,
  type AppleMusicBackgroundAudio,
  type AppleMusicBackgroundRenderer,
} from "./appleMusicBackground/AppleMusicBackgroundRenderer";

const props = defineProps<{
  /** 用作背景纹理的封面缩略图。 */
  album: string;
  /** 是否继续运行基础材质动画。 */
  active: boolean;
  /** 是否申请 FFT 并响应低频瞬态。 */
  audioEnabled: boolean;
  /** 背景渲染实现。 */
  variant: AppleMusicBackgroundVariant;
  /** 最大渲染帧率。 */
  fps: number;
  /** 网格与封面层的流动速度。 */
  flowSpeed: number;
  /** 内部渲染分辨率比例。 */
  renderScale: number;
  /** 双向模糊强度。 */
  blurLevel: number;
  /** Dev 背景的扭曲程度。 */
  distortion: number;
  /** 背景压暗程度。 */
  dimness: number;
  /** 低频对网格形变的放大倍率。 */
  beatStrength: number;
}>();

const wrapperRef = ref<HTMLDivElement>();
const renderer = shallowRef<AppleMusicBackgroundRenderer>();
const rendererAvailable = ref(true);
const rendererReady = ref(false);
const pageHidden = ref(document.hidden);
const analyzer = createAppleMusicBackgroundAudioAnalyzer();

let fftTimer: ReturnType<typeof setInterval> | undefined;
let fftAcquired = false;
let lastFrame: readonly [number[], number[]] = [[], []];
let lastFreshAt = 0;
let lastSampleAt = 0;
let albumToken = 0;
let albumRetry: string | undefined;
let rendererCanvas: HTMLCanvasElement | undefined;

const zeroAudio = (): AppleMusicBackgroundAudio => analyzer.reset();

const sampleAudio = (): void => {
  const now = performance.now();
  const elapsed = lastSampleAt > 0 ? Math.min(100, now - lastSampleAt) : 50;
  lastSampleAt = now;
  const frame = getFftFrame();
  if (frame !== lastFrame && frame[0].length > 0 && frame[1].length > 0) {
    lastFrame = frame;
    lastFreshAt = now;
    renderer.value?.updateAudio(analyzer.update(frame, elapsed));
    return;
  }
  if (lastFreshAt > 0 && now - lastFreshAt >= 250) {
    renderer.value?.updateAudio(analyzer.update([[], []], elapsed));
  }
};

const startFft = (): void => {
  if (fftAcquired) return;
  acquireFft();
  fftAcquired = true;
  const now = performance.now();
  lastFrame = getFftFrame();
  lastFreshAt = now;
  lastSampleAt = now;
  renderer.value?.updateAudio(zeroAudio());
  fftTimer = setInterval(sampleAudio, 50);
};

const stopFft = (): void => {
  if (fftTimer !== undefined) {
    clearInterval(fftTimer);
    fftTimer = undefined;
  }
  if (fftAcquired) {
    releaseFft();
    fftAcquired = false;
  }
  lastFrame = [[], []];
  lastFreshAt = 0;
  lastSampleAt = 0;
  renderer.value?.updateAudio(zeroAudio());
};

const syncActivity = (): void => {
  const visible = props.active && !pageHidden.value;
  const active = visible && !!renderer.value;
  const audioEnabled = props.audioEnabled && active;
  renderer.value?.setVisible(visible);
  renderer.value?.setPlaying(active);
  if (audioEnabled) startFft();
  else stopFft();
};

const updateAlbum = async (album: string): Promise<void> => {
  const token = ++albumToken;
  const ready = await renderer.value?.updateAlbum(album);
  if (token !== albumToken) return;
  if (ready) {
    rendererReady.value = true;
    albumRetry = undefined;
  } else {
    albumRetry = album;
  }
};

const onContextRestored = (): void => {
  if (albumRetry) void updateAlbum(albumRetry);
};

const onVisibilityChange = (): void => {
  pageHidden.value = document.hidden;
  syncActivity();
};

onMounted(() => {
  if (!wrapperRef.value) return;
  let instance: AppleMusicBackgroundRenderer | undefined;
  try {
    instance = createAppleMusicBackgroundRenderer({
      variant: props.variant,
      renderScale: props.renderScale,
      fps: props.fps,
      flowSpeed: props.flowSpeed,
      distortion: props.distortion,
      blurLevel: props.blurLevel,
      beatStrength: props.beatStrength,
      darkOverlay: props.dimness,
    });
    instance.mount(wrapperRef.value);
    rendererCanvas = instance.getElement();
    rendererCanvas.addEventListener("webglcontextrestored", onContextRestored);
    renderer.value = instance;
    void updateAlbum(props.album);
  } catch {
    instance?.dispose();
    rendererAvailable.value = false;
  }
  document.addEventListener("visibilitychange", onVisibilityChange);
  syncActivity();
});

watch(
  () => props.album,
  (album) => void updateAlbum(album),
);

watch([() => props.active, () => props.audioEnabled], syncActivity);

watch(
  [
    () => props.fps,
    () => props.flowSpeed,
    () => props.renderScale,
    () => props.blurLevel,
    () => props.distortion,
    () => props.dimness,
    () => props.beatStrength,
  ],
  ([fps, flowSpeed, renderScale, blurLevel, distortion, dimness, beatStrength]) => {
    renderer.value?.updateOptions({
      fps,
      flowSpeed,
      renderScale,
      blurLevel,
      distortion,
      darkOverlay: dimness,
      beatStrength,
    });
  },
);

onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", onVisibilityChange);
  rendererCanvas?.removeEventListener("webglcontextrestored", onContextRestored);
  rendererCanvas = undefined;
  stopFft();
  renderer.value?.dispose();
  renderer.value = undefined;
});
</script>

<template>
  <div ref="wrapperRef" class="apple-music-background" aria-hidden="true">
    <img
      v-if="!rendererReady || !rendererAvailable"
      :src="album"
      decoding="async"
      alt=""
      class="fallback-artwork"
    />
  </div>
</template>

<style scoped>
.apple-music-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  background: rgb(18 16 24);
}

.fallback-artwork {
  position: absolute;
  inset: -12%;
  width: 124%;
  height: 124%;
  object-fit: cover;
  filter: blur(48px) saturate(1.18);
  opacity: 0.78;
}

:deep(canvas) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
}
</style>
