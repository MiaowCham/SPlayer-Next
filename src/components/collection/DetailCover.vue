<script setup lang="ts">
import type { SImgProps } from "@/components/ui/SImg.vue";
import defaultFallback from "@/assets/images/song.jpg";

const props = withDefaults(defineProps<SImgProps>(), {
  fallback: defaultFallback,
  alt: "",
});

const loaded = ref(false);
/** 上一张封面：换图时保留在底层，新图淡入覆盖，形成交叉淡化 */
const previousSrc = ref<string | null>(null);
let previousClearTimer: ReturnType<typeof setTimeout> | undefined;
/** 缩略图本身失效时退回内置占位图，避免播放器持续显示破图 */
const fallbackSrc = ref(props.fallback || defaultFallback);

watch(
  () => props.fallback,
  (value) => {
    fallbackSrc.value = value || defaultFallback;
  },
);

watch(
  () => props.src,
  (value, oldValue) => {
    loaded.value = false;
    if (oldValue && value && oldValue !== value) {
      previousSrc.value = oldValue;
    }
  },
);

/**
 * 新封面解码完成后移除缩略图，忽略已被下一地址替换的加载结果
 * @param event - 原生图片加载事件
 */
const handleLoad = async (event: Event): Promise<void> => {
  const image = event.target as HTMLImageElement;
  try {
    await image.decode();
  } catch {
    return;
  }
  if (image.getAttribute("src") !== props.src) return;
  loaded.value = true;
  // 交叉淡化结束后移除底层旧图
  if (previousSrc.value) {
    if (previousClearTimer) clearTimeout(previousClearTimer);
    previousClearTimer = setTimeout(() => {
      previousSrc.value = null;
      previousClearTimer = undefined;
    }, 520);
  }
};

onUnmounted(() => {
  if (previousClearTimer) clearTimeout(previousClearTimer);
});

/** 兜底图加载失败时改用内置占位图 */
const handleFallbackError = (): void => {
  if (fallbackSrc.value !== defaultFallback) fallbackSrc.value = defaultFallback;
};
</script>

<template>
  <div class="relative isolate overflow-hidden">
    <img
      v-if="!loaded"
      :src="fallbackSrc"
      :alt="alt"
      class="absolute inset-0 size-full object-cover"
      decoding="async"
      @error="handleFallbackError"
    />
    <img
      v-if="previousSrc"
      :src="previousSrc"
      :alt="alt"
      class="absolute inset-0 size-full object-cover"
      aria-hidden="true"
      decoding="async"
    />
    <img
      v-if="src"
      :key="src"
      :src="src"
      :alt="alt"
      data-cover-image
      class="absolute inset-0 size-full object-cover transition-opacity duration-500 ease-out"
      :style="{ opacity: loaded ? 1 : 0 }"
      loading="eager"
      decoding="async"
      @load="handleLoad"
      @error="loaded = false"
    />
  </div>
</template>
