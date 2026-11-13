<script setup lang="ts">
import { AppleMusicBackground, type BackgroundVariant } from "@/modules/apple-music-background";
import { getFftFrame } from "@/services/playback";
import { acquireFft, releaseFft } from "@/services/fftCapture";
import { getBassPulse } from "@/services/audioFeatures";

const props = defineProps<{
  album: string;
  variant: BackgroundVariant;
  visible: boolean;
  playing: boolean;
  audioPlaying: boolean;
  hasLyric: boolean;
  fps: number;
  flowSpeed: number;
  renderScale: number;
  enableBeat: boolean;
}>();
const wrapper = ref<HTMLDivElement>();
const pageVisible = useDocumentVisibility();
const renderFailed = ref(false);
let renderer: AppleMusicBackground | undefined;
let fftAcquired = false;
let pulse = 0;
let previousFft: ReturnType<typeof getFftFrame> | undefined;

const { resume, pause } = useRafFn(
  () => {
    const fft = getFftFrame();
    if (!fft || fft === previousFft) return;
    previousFft = fft;
    const next = getBassPulse(fft);
    pulse += (next - pulse) * (next > pulse ? 0.45 : 0.14);
    // 复用原生 FFT 能量输入，沿用参考实现 0.33 的平方脉冲倍率。
    renderer?.setImageScale(1 + 0.33 * pulse * pulse);
  },
  { immediate: false },
);

/** 同步可见性与 FFT 所有权，冻结/隐藏不保留额外高频循环。 */
function syncState(): void {
  const visible = props.visible && pageVisible.value === "visible";
  renderer?.update({
    visible,
    playing: props.playing,
    hasLyrics: props.hasLyric,
    fps: props.fps,
    flowSpeed: props.flowSpeed,
    renderScale: props.renderScale,
    // 全屏播放器使用白色歌词与暗色材质，不跟随设置页面的明暗主题。
    light: false,
  });
  const needsFft =
    Boolean(renderer) &&
    !renderFailed.value &&
    visible &&
    props.playing &&
    props.audioPlaying &&
    props.hasLyric &&
    props.enableBeat &&
    props.variant === "modern";
  if (needsFft) {
    if (!fftAcquired) {
      acquireFft();
      fftAcquired = true;
    }
    resume();
  } else {
    pause();
    if (fftAcquired) {
      releaseFft();
      fftAcquired = false;
    }
    pulse = 0;
    previousFft = undefined;
    renderer?.setImageScale(1);
  }
}

onMounted(() => {
  if (!wrapper.value) return;
  renderer = new AppleMusicBackground(wrapper.value, props.variant, (error) => {
    renderFailed.value = true;
    console.warn("[AppleMusicBackground]", error);
  });
  syncState();
  void renderer.setAlbum(props.album);
});
watch(
  () => props.album,
  (album) => {
    void renderer?.setAlbum(album);
    // 换曲后丢掉上一首的平滑状态
    pulse = 0;
    previousFft = undefined;
  },
);
watch(
  () => [
    props.visible,
    props.playing,
    props.audioPlaying,
    props.hasLyric,
    props.fps,
    props.flowSpeed,
    props.renderScale,
    props.enableBeat,
    pageVisible.value,
    renderFailed.value,
  ],
  syncState,
);
onBeforeUnmount(() => {
  pause();
  if (fftAcquired) releaseFft();
  fftAcquired = false;
  renderer?.dispose();
  renderer = undefined;
});
</script>

<template>
  <div
    ref="wrapper"
    class="absolute inset-0 overflow-hidden pointer-events-none"
    aria-hidden="true"
  />
</template>
