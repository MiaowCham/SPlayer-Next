<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import { normalizePlayerBgType } from "@/types/settings";
import DEFAULT_COVER from "@/assets/images/song.jpg";
import BackgroundRender from "./BackgroundRender.vue";
import AppleMusicBackground from "./AppleMusicBackground.vue";

const media = useMediaStore();
const settings = useSettingsStore();
const status = useStatusStore();

const bgType = computed(() => normalizePlayerBgType(settings.player.playerBgType));
const appleMusicBgVariant = computed(() => (bgType.value === "apple-music-beta" ? "beta" : "dev"));

/**
 * 背景是否就绪
 * 展开后延迟 500ms 再挂载，收起后延迟 500ms 卸载以释放 WebGL 上下文 / 模糊位图
 */
const bgReady = ref(false);
let bgReadyTimer: ReturnType<typeof setTimeout> | undefined;

watch(
  () => status.isPlayerExpanded,
  (expanded) => {
    clearTimeout(bgReadyTimer);
    if (expanded) {
      // 已就绪（快速收起后又展开）则保留，避免无谓地卸载重建
      if (!bgReady.value) {
        bgReadyTimer = setTimeout(() => {
          bgReady.value = true;
        }, 500);
      }
    } else {
      // 等收起动画结束后再卸载
      bgReadyTimer = setTimeout(() => {
        bgReady.value = false;
      }, 500);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => clearTimeout(bgReadyTimer));

const fluidBgPlaying = computed(() => {
  if (!status.isPlayerExpanded) return false;
  if (!status.isPlaying && settings.player.playerBgFreezeOnPause) return false;
  return true;
});

const appleMusicBgPlaying = computed(() => {
  if (!status.isPlayerExpanded) return false;
  if (!status.isPlaying && settings.player.appleMusicBgFreezeOnPause) return false;
  return true;
});

// 模糊模式：双缓冲层，切歌时交叉淡入淡出
const initialCover = media.track?.cover || media.track?.coverOriginal || DEFAULT_COVER;
const blurLayers = reactive([
  { src: initialCover, active: true },
  { src: "", active: false },
]);
let currentLayerIndex = 0;
let preloadImg: HTMLImageElement | null = null;
let switchToken = 0;

watch(
  [() => media.track?.cover || media.track?.coverOriginal, () => status.isPlayerExpanded],
  ([newCover, expanded]) => {
    if (!expanded) return;
    const token = ++switchToken;

    if (preloadImg) {
      preloadImg.src = "";
      preloadImg = null;
    }
    const targetCover = newCover || DEFAULT_COVER;
    // 相同不切换
    if (blurLayers[currentLayerIndex].src === targetCover) return;
    const nextIndex = currentLayerIndex === 0 ? 1 : 0;
    const switchLayer = (src: string) => {
      if (token !== switchToken) return;
      preloadImg = null;
      blurLayers[nextIndex].src = src;
      nextTick(() => {
        if (token !== switchToken) return;
        requestAnimationFrame(() => {
          if (token !== switchToken) return;
          blurLayers[nextIndex].active = true;
          blurLayers[currentLayerIndex].active = false;
          currentLayerIndex = nextIndex;
        });
      });
    };
    const img = new Image();
    preloadImg = img;
    img.src = targetCover;
    img
      .decode()
      .then(() => switchLayer(targetCover))
      .catch(() => switchLayer(DEFAULT_COVER));
  },
);

onBeforeUnmount(() => {
  clearTimeout(bgReadyTimer);
  switchToken++;
  if (preloadImg) {
    preloadImg.src = "";
    preloadImg = null;
  }
  blurLayers[0].src = "";
  blurLayers[1].src = "";
});
</script>

<template>
  <!-- 纯色背景 -->
  <div class="absolute inset-0 overflow-hidden -z-1 bg-solid-wrap">
    <div class="color bg-cover-base" />
  </div>
  <!-- 模糊背景 -->
  <Transition v-if="bgType === 'blur'" name="bg-fade">
    <div v-if="bgReady" class="absolute inset-0 overflow-hidden -z-1 bg-blur-wrap">
      <img
        v-for="(layer, index) in blurLayers"
        :key="index"
        :src="layer.src"
        :class="['bg-img', { active: layer.active }]"
        decoding="async"
        alt=""
      />
    </div>
  </Transition>
  <!-- 流体背景 -->
  <Transition v-else-if="bgType === 'animation'" name="bg-fade">
    <div v-if="bgReady" class="absolute inset-0 overflow-hidden -z-1">
      <BackgroundRender
        :album="media.track?.cover || DEFAULT_COVER"
        :playing="fluidBgPlaying"
        :fps="settings.player.playerBgFps"
        :flow-speed="settings.player.playerBgFlowSpeed"
        :render-scale="settings.player.playerBgRenderScale"
        :has-lyric="media.parsedLyric.length > 0"
        :enable-beat="settings.player.playerBgBeat"
      />
    </div>
  </Transition>
  <!-- Apple Music 风格封面纹理背景 -->
  <Transition
    v-else-if="bgType === 'apple-music-dev' || bgType === 'apple-music-beta'"
    name="bg-fade"
  >
    <div v-if="bgReady" class="absolute inset-0 overflow-hidden -z-1">
      <AppleMusicBackground
        :key="appleMusicBgVariant"
        :album="media.track?.cover || media.track?.coverOriginal || DEFAULT_COVER"
        :active="appleMusicBgPlaying"
        :variant="appleMusicBgVariant"
        :audio-enabled="
          status.isPlayerExpanded && status.isPlaying && settings.player.appleMusicBgBeat
        "
        :fps="settings.player.appleMusicBgFps"
        :flow-speed="settings.player.appleMusicBgFlowSpeed"
        :render-scale="settings.player.appleMusicBgRenderScale"
        :blur-level="settings.player.appleMusicBgBlurStrength"
        :distortion="settings.player.appleMusicBgDistortion"
        :dimness="settings.player.appleMusicBgDimness"
        :beat-strength="settings.player.appleMusicBgBeatStrength"
      />
    </div>
  </Transition>
</template>

<style scoped>
/* 纯色模式 */
.bg-solid-wrap {
  background-color: rgb(20, 20, 28);
}

.bg-solid-wrap .color {
  width: 100%;
  height: 100%;
  transition: background-color 0.5s ease;
}

.bg-solid-wrap::after {
  content: "";
  position: absolute;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
}

/* 模糊模式 */
.bg-blur-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
}

.bg-blur-wrap::after {
  content: "";
  position: absolute;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 1;
}

.bg-blur-wrap .bg-img {
  position: absolute;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scale(1.5);
  filter: blur(45px) saturate(1.2);
  opacity: 0;
  transition: opacity 0.5s ease-in-out;
}

.bg-blur-wrap .bg-img.active {
  opacity: 1;
}

/* 流体背景渐入 */
.bg-fade-enter-active {
  transition: opacity 0.8s ease-in-out;
}

.bg-fade-leave-active {
  transition: opacity 0.3s ease-in;
}

.bg-fade-enter-from,
.bg-fade-leave-to {
  opacity: 0;
}
</style>
