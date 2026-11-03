<script lang="ts">
const hdCache = shallowRef<{ id: string; data: string } | null>(null);
</script>

<script setup lang="ts">
import Hls from "hls.js";
import {
  invalidateDynamicCover,
  resolveDynamicCover,
  type DynamicCoverResult,
} from "@/services/dynamicCover";
import { isSameCoverArt } from "@/utils/coverFingerprint";
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { useUserStore } from "@/stores/user";
import { useTimeoutFn } from "@vueuse/core";

const media = useMediaStore();
const status = useStatusStore();
const settings = useSettingsStore();
const user = useUserStore();

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

/** 动态封面地址与格式 */
const dynamicCover = ref<DynamicCoverResult | null>(null);
/** 动态封面是否已加载出首帧 */
const dynamicCoverLoaded = ref<boolean>(false);
const videoRef = ref<HTMLVideoElement | null>(null);
/** HLS 播放实例，非 mp4 动态封面需要它做 MSE 播放 */
let hls: Hls | null = null;

/** 释放 HLS 实例，避免离开播放页后继续拉流 */
const destroyHls = (): void => {
  hls?.destroy();
  hls = null;
};

/**
 * 按格式给视频元素挂载媒体源
 * @param result - 动态封面解析结果
 */
const attachVideoSource = async (result: DynamicCoverResult | null): Promise<void> => {
  await nextTick();
  const video = videoRef.value;
  if (!video || !result) return;
  if (result.format === "mp4") {
    video.src = result.url;
    return;
  }
  if (Hls.isSupported()) {
    destroyHls();
    hls = new Hls({ enableWorker: true, lowLatencyMode: false });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      void window.api.lyrics.log(
        "warn",
        `[am-cover] hls error ${data.type}/${data.details} fatal=${data.fatal}`,
      );
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      void window.api.lyrics.log("info", "[am-cover] hls manifest parsed");
    });
    hls.loadSource(result.url);
    hls.attachMedia(video);
    return;
  }
  video.src = result.url;
};

/** 动态封面再放送：视频结束后 2s 重新播放 */
const { start: dynamicCoverStart, stop: dynamicCoverStop } = useTimeoutFn(
  () => {
    const video = videoRef.value;
    if (!video) return;
    // HLS 播完后 currentTime 停在结尾，复位才能重播
    if (video.currentTime > 0) video.currentTime = 0;
    void video.play();
  },
  2000,
  { immediate: false },
);

/** 拉取动态封面：开关开启且非加载中才生效 */
const fetchDynamicCover = async (): Promise<void> => {
  const track = displayTrack.value;
  if (!track) {
    dynamicCover.value = null;
    destroyHls();
    return;
  }
  if (!settings.player.dynamicCover || status.trackLoading) {
    dynamicCover.value = null;
    destroyHls();
    return;
  }

  dynamicCoverStop();
  dynamicCoverLoaded.value = false;

  let result = await resolveDynamicCover(
    track,
    settings.player.appleMusicStorefront,
    user.isLoggedIn,
  );
  if (displayTrack.value?.id !== track.id) return;

  // 专辑名相同也可能是不同版本封面，始终比对指纹；取不到图时接受
  let same: boolean | null = null;
  if (result?.artwork) {
    const trackCover =
      hdCache.value?.id === track.id ? hdCache.value.data : (track.cover ?? track.coverOriginal);
    same = trackCover ? await isSameCoverArt(trackCover, result.artwork) : null;
    if (same === false) result = null;
  }
  void window.api.lyrics.log(
    "info",
    `[am-cover] ${track.title} decided=${result ? result.format : "none"} exact=${result?.exact ?? "-"} coverSame=${same === null ? "unknown" : same}`,
  );
  if (displayTrack.value?.id !== track.id) return;

  dynamicCover.value = result;
  await attachVideoSource(result);
};

/** 首帧就绪后淡入视频层 */
const onCoverFrame = (): void => {
  dynamicCoverLoaded.value = true;
  void window.api.lyrics.log("info", "[am-cover] first frame ready");
};

const onCoverError = (): void => {
  const video = videoRef.value;
  void window.api.lyrics.log(
    "warn",
    `[am-cover] video error code=${video?.error?.code ?? "-"} msg=${video?.error?.message ?? "-"}`,
  );
  // 资源失效（节日封面已下架等）时清掉缓存，下次播放重新解析
  const track = displayTrack.value;
  if (track) invalidateDynamicCover(track, settings.player.appleMusicStorefront);
};

const onDynamicCoverEnded = (): void => {
  dynamicCoverLoaded.value = false;
  dynamicCoverStart();
};

/** 卸载或切歌时清理视频元素，避免继续解码 */
const cleanupDynamicCover = (): void => {
  destroyHls();
  if (videoRef.value) {
    videoRef.value.pause();
    videoRef.value.removeAttribute("src");
    videoRef.value.load();
  }
  dynamicCover.value = null;
  dynamicCoverLoaded.value = false;
};

watch(
  () => [displayTrack.value?.id, settings.player.dynamicCover, status.trackLoading] as const,
  () => {
    fetchDynamicCover();
  },
);

onMounted(() => {
  fetchDynamicCover();
});

onBeforeUnmount(() => {
  dynamicCoverStop();
  cleanupDynamicCover();
});
</script>

<template>
  <!-- 外观由布局决定，这里只负责高清封面、动态封面与共享过渡标记 -->
  <div data-player-cover="full" class="relative overflow-hidden shrink-0">
    <DetailCover :src="coverSrc" :fallback="displayTrack?.cover" class="size-full" />
    <Transition name="fade" mode="out-in">
      <video
        v-if="dynamicCover"
        ref="videoRef"
        :src="dynamicCover.format === 'mp4' ? dynamicCover.url : undefined"
        :class="['dynamic-cover', { loaded: dynamicCoverLoaded }]"
        muted
        autoplay
        playsinline
        @loadeddata="onCoverFrame"
        @error="onCoverError"
        @ended="onDynamicCoverEnded"
      />
    </Transition>
  </div>
</template>

<style scoped>
.dynamic-cover {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 1;
  opacity: 0;
  transition: opacity 0.8s ease-in-out;
  backface-visibility: hidden;
  transform: translateZ(0);
}

.dynamic-cover.loaded {
  opacity: 1;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
