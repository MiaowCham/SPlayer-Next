<script setup lang="ts">
import {
  BackgroundRender as CoreBackgroundRender,
  MeshGradientRenderer,
  IsolationRenderer,
  PixiRenderer,
  TitaniumRenderer,
  type BaseRenderer,
  type IsolationRendererOptions,
  type TitaniumRendererOptions,
} from "@applemusic-like-lyrics/core-bg";
import { getFftFrame } from "@/services/playback";
import { acquireFft, releaseFft } from "@/services/fftCapture";
import { getBassPulse, toAmllLowFreqVolume } from "@/services/audioFeatures";

/** 可选的流体背景渲染引擎 */
export type BackgroundRenderEngine = "mesh" | "isolation" | "pixi" | "titanium";

const RENDERER_MAP = {
  mesh: MeshGradientRenderer,
  isolation: IsolationRenderer,
  pixi: PixiRenderer,
  titanium: TitaniumRenderer,
} as const;

export interface BackgroundRenderProps {
  /** 专辑封面资源 URL */
  album?: string;
  /** 是否处于播放状态，默认为 true */
  playing?: boolean;
  /** 动画流动速度，默认为 2 */
  flowSpeed?: number;
  /** 是否有歌词，默认为 true */
  hasLyric?: boolean;
  /** 帧率，默认为 30 */
  fps?: number;
  /** 渲染缩放比例，默认为 0.5 */
  renderScale?: number;
  /** 是否随低频节拍脉动（默认 false，关闭则不采集 FFT） */
  enableBeat?: boolean;
  /** 渲染引擎，默认为 mesh */
  renderEngine?: BackgroundRenderEngine;
  /** isolation 参数：光波 / 抖动 / 取色算法 */
  isolationOptions?: Partial<IsolationRendererOptions>;
  /** Titanium 流沙渲染器参数（仅 titanium 引擎支持） */
  titaniumOptions?: Partial<TitaniumRendererOptions>;
}

const props = withDefaults(defineProps<BackgroundRenderProps>(), {
  playing: true,
  flowSpeed: 2,
  hasLyric: true,
  fps: 30,
  renderScale: 0.5,
  enableBeat: false,
  renderEngine: "mesh",
  isolationOptions: () => ({}),
  titaniumOptions: () => ({}),
});

const emit = defineEmits<{ ready: [] }>();
const wrapperRef = ref<HTMLDivElement | null>(null);
const visibility = useDocumentVisibility();
let readyFrame = 0;
let albumVersion = 0;

type CoreRenderer = CoreBackgroundRender<BaseRenderer>;

// 外部渲染器实例引用
const bgRenderRef = shallowRef<CoreRenderer>();

/**
 * 按当前引擎创建渲染器；引擎不受当前设备支持时回退到 mesh
 * @returns 已挂载的渲染器包装实例
 */
const createRenderer = (): CoreRenderer | undefined => {
  const container = wrapperRef.value;
  if (!container) return undefined;

  let engine = props.renderEngine;
  if (engine === "isolation" && !IsolationRenderer.isSupported()) engine = "mesh";
  if (engine === "titanium" && !TitaniumRenderer.isSupported()) engine = "mesh";

  // 各引擎构造函数签名一致，统一收窄到 BaseRenderer 再交给工厂
  const ctor = RENDERER_MAP[engine] as new (canvas: HTMLCanvasElement) => BaseRenderer;
  const instance = CoreBackgroundRender.new(ctor);
  const el = instance.getElement();
  el.style.width = "100%";
  el.style.height = "100%";
  el.style.display = "block";
  container.replaceChildren(el);
  return instance;
};

/**
 * 同步各引擎专有选项（isolation 光波/抖动/取色，titanium 流沙参数）
 */
const syncRendererOptions = () => {
  const renderer = bgRenderRef.value?.getRenderer();
  if (renderer instanceof IsolationRenderer) {
    renderer.setOptions({ ...props.isolationOptions });
  }
  if (renderer instanceof TitaniumRenderer) {
    renderer.setOptions({ ...props.titaniumOptions });
  }
};

/**
 * 统一同步更新属性状态到底层渲染器
 */
const updateRendererState = () => {
  const renderer = bgRenderRef.value;
  if (!renderer) return;

  loadAlbum();
  renderer.setFPS(props.fps);
  renderer.setRenderScale(props.renderScale);
  renderer.setHasLyric(props.hasLyric);
  syncRendererOptions();
  syncRendererMotion();
};

/** 加载封面后等待画布完成首帧，再移除缩略图预览 */
const loadAlbum = (): void => {
  const version = ++albumVersion;
  const renderer = bgRenderRef.value;
  const album = props.album;
  cancelAnimationFrame(readyFrame);
  if (!renderer || !album) return;
  void renderer.setAlbum(album, false).then(
    () => {
      if (version !== albumVersion) return;
      readyFrame = requestAnimationFrame(() => {
        readyFrame = requestAnimationFrame(() => emit("ready"));
      });
    },
    (error) => console.warn("[background] 背景封面加载失败", error),
  );
};

/**
 * 同步流体背景运动状态
 */
const syncRendererMotion = () => {
  const renderer = bgRenderRef.value;
  if (!renderer) return;

  if (visibility.value !== "visible") {
    renderer.pause();
    return;
  }
  renderer.setStaticMode(!props.playing);
  renderer.setFlowSpeed(props.playing ? props.flowSpeed : 0);
  renderer.resume();
};

/**
 * 释放当前渲染器并重建，用于切换引擎
 */
const recreateRenderer = () => {
  const previous = bgRenderRef.value;
  bgRenderRef.value = undefined;
  if (previous) {
    previous.pause();
    previous.dispose();
  }
  bgRenderRef.value = createRenderer();
  updateRendererState();
  syncFftCapture();
};

const BASS_ATTACK = 0.45;
const BASS_DECAY = 0.14;

// 低频平滑后脉冲
let smoothedPulse = 0;
let lastFftFrame: readonly [number[], number[]] = [[], []];

/**
 * 从最新 FFT 帧数据计算低频音量能量值 [0.0 - 1.0]
 */
const updateLowFreqVolume = () => {
  const data = getFftFrame();
  if (!data || data[0].length === 0) return;
  if (data === lastFftFrame) return;
  lastFftFrame = data;

  const pulse = getBassPulse(data);
  const smoothFactor = pulse > smoothedPulse ? BASS_ATTACK : BASS_DECAY;
  smoothedPulse = smoothedPulse + smoothFactor * (pulse - smoothedPulse);

  bgRenderRef.value?.setLowFreqVolume(toAmllLowFreqVolume(smoothedPulse));
};

const { resume: resumeFftLoop, pause: pauseFftLoop } = useRafFn(updateLowFreqVolume, {
  immediate: false,
});

// 本地持有标记，保证 acquire / release 严格配对
let fftAcquired = false;

/**
 * 开始捕获 FFT 频谱数据
 */
const startFftCapture = () => {
  if (!fftAcquired) {
    acquireFft();
    fftAcquired = true;
  }
  resumeFftLoop();
};

/**
 * 停止捕获 FFT 频谱数据
 */
const stopFftCapture = () => {
  pauseFftLoop();
  if (fftAcquired) {
    releaseFft();
    fftAcquired = false;
  }
};

/**
 * 按播放状态与跳动开关同步 FFT 采集
 */
const syncFftCapture = () => {
  if (visibility.value === "visible" && props.playing && props.enableBeat) {
    startFftCapture();
  } else {
    stopFftCapture();
    if (!props.enableBeat) {
      smoothedPulse = 0;
      lastFftFrame = [[], []];
      bgRenderRef.value?.setLowFreqVolume(1.0);
    }
  }
};

onMounted(() => {
  if (!wrapperRef.value) return;
  bgRenderRef.value = createRenderer();
  updateRendererState();
  syncFftCapture();
});

onBeforeUnmount(() => {
  albumVersion++;
  cancelAnimationFrame(readyFrame);
  stopFftCapture();

  const renderer = bgRenderRef.value;
  if (renderer) {
    // 同步释放底层 Canvas 与 WebGL 上下文，避免上下文泄漏
    renderer.pause();
    renderer.dispose();
    bgRenderRef.value = undefined;
  }
});

// 属性变化监听
watch(
  () => props.album,
  () => {
    loadAlbum();
    // 换封面即换曲，丢掉上一首的平滑状态
    smoothedPulse = 0;
    lastFftFrame = [[], []];
  },
);

watch([() => props.playing, visibility], () => {
  syncRendererMotion();
  syncFftCapture();
});

watch(
  () => props.enableBeat,
  () => syncFftCapture(),
);

watch(
  () => props.renderEngine,
  () => recreateRenderer(),
);

watch(
  () => props.isolationOptions,
  () => syncRendererOptions(),
  { deep: true },
);

watch(
  () => props.titaniumOptions,
  () => syncRendererOptions(),
  { deep: true },
);

watch(
  () => props.fps,
  (val) => {
    bgRenderRef.value?.setFPS(val);
  },
);

watch(
  () => props.flowSpeed,
  (val) => {
    if (props.playing) bgRenderRef.value?.setFlowSpeed(val);
  },
);

watch(
  () => props.renderScale,
  (val) => {
    bgRenderRef.value?.setRenderScale(val);
  },
);

watch(
  () => props.hasLyric,
  (val) => {
    bgRenderRef.value?.setHasLyric(val);
  },
);

defineExpose({
  bgRender: bgRenderRef,
  wrapperEl: wrapperRef,
});
</script>

<template>
  <div ref="wrapperRef" class="background-render-wrapper" aria-hidden="true" />
</template>

<style scoped>
.background-render-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  z-index: 0;
  pointer-events: none;
}
</style>
