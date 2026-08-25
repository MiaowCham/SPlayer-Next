<script setup lang="ts">
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import { useSettingsDialog } from "@/settings/useSettingsDialog";
import { formatLyricOffset } from "@/utils/time";
import IconLucideLanguages from "~icons/lucide/languages";

defineProps<{
  /** 是否处于沉浸模式 */
  immersive: boolean;
}>();

const emit = defineEmits<{
  /** 请求将歌词滚动到当前播放位置 */
  (e: "locate"): void;
}>();

const { t } = useI18n();
const media = useMediaStore();
const settings = useSettingsStore();
const status = useStatusStore();
const settingsDialog = useSettingsDialog();

/** 歌词偏移步长（ms） */
const LYRIC_OFFSET_STEP = 500;

/** 偏移弹层是否打开；打开期间按钮组保持可见 */
const offsetPopoverOpen = ref(false);

/** 翻译与发音快捷开关是否打开 */
const contentPopoverOpen = ref(false);

const hasTrack = computed(() => !!media.track);

/** 当前是否有可复制的歌词 */
const hasLyric = computed(() => media.parsedLyric.length > 0);

/** 当前歌词是否包含翻译。 */
const hasTranslation = computed(() =>
  media.parsedLyric.some((line) => line.translatedLyric.trim().length > 0),
);

/** 当前歌词是否包含逐行或逐字发音。 */
const hasPronunciation = computed(() =>
  media.parsedLyric.some(
    (line) =>
      line.romanLyric.trim().length > 0 ||
      line.words.some((word) => (word.romanWord?.trim().length ?? 0) > 0),
  ),
);

/** 复制歌词弹窗是否打开 */
const copyDialogOpen = ref(false);

/** 当前曲目偏移（ms） */
const songOffset = computed(() => status.lyricOffsetMs);
const offsetDisplay = computed(() => formatLyricOffset(songOffset.value));

/** 写入偏移 */
const writeOffset = (offsetMs: number): void => {
  const id = media.track?.id;
  if (!id) return;
  window.api.nowPlaying.setLyricOffset(id, offsetMs);
};

/** 弹层里直接编辑（ms） */
const offsetInputMs = computed<number>({
  get: () => songOffset.value,
  set: (val) => writeOffset(val ?? 0),
});

const getOffsetStep = (event: MouseEvent): number => {
  if (event.ctrlKey) return 50;
  if (event.shiftKey) return 250;
  return LYRIC_OFFSET_STEP;
};

const advanceLyric = (event: MouseEvent): void =>
  writeOffset(songOffset.value + getOffsetStep(event));
const delayLyric = (event: MouseEvent): void =>
  writeOffset(songOffset.value - getOffsetStep(event));
const resetLyricOffset = (): void => writeOffset(0);
</script>

<template>
  <div
    class="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col items-center gap-2 transition-opacity duration-300"
    :class="
      immersive
        ? 'opacity-0 pointer-events-none'
        : offsetPopoverOpen || contentPopoverOpen
          ? 'opacity-100 pointer-events-auto'
          : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
    "
  >
    <SButton
      type="cover"
      variant="ghost"
      circle
      :size="40"
      :disabled="!hasLyric"
      @click="copyDialogOpen = true"
    >
      <template #icon><IconLucideCopy /></template>
    </SButton>
    <SButton
      type="cover"
      variant="ghost"
      circle
      :size="40"
      :disabled="!hasLyric"
      @click="emit('locate')"
    >
      <template #icon><IconLucideLocateFixed /></template>
    </SButton>
    <div class="h-px w-6 bg-cover/25 my-1" />
    <SButton
      type="cover"
      variant="ghost"
      circle
      :size="40"
      :disabled="!hasTrack"
      @click="advanceLyric"
    >
      <template #icon><IconLucidePlus /></template>
    </SButton>
    <SPopover v-model:open="offsetPopoverOpen" trigger="click" side="left" :side-offset="8" cover>
      <template #trigger>
        <div
          class="inline-flex items-center justify-center gap-0.5 h-6 w-10 rounded-md cursor-pointer border border-solid border-cover/30 bg-cover/8 hover:bg-cover/15 transition-colors tabular-nums"
          :class="!hasTrack ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''"
        >
          <span class="text-xs font-medium text-cover">
            {{ offsetDisplay.value }}
          </span>
          <span v-if="offsetDisplay.unit === 's'" class="text-[10px] text-cover/60">
            {{ offsetDisplay.unit }}
          </span>
        </div>
      </template>
      <div class="flex flex-col gap-2 w-44">
        <h4 class="m-0 text-sm font-medium leading-tight text-cover">
          {{ t("player.lyricOffset.title") }}
        </h4>
        <p class="m-0 text-xs text-cover/60">{{ t("player.lyricOffset.hint") }}</p>
        <SNumberInput
          v-model="offsetInputMs"
          :step="1"
          size="small"
          unit="ms"
          placeholder="0"
          cover
        />
        <SButton
          type="cover"
          variant="secondary"
          size="tiny"
          :disabled="songOffset === 0"
          @click="resetLyricOffset"
        >
          {{ t("common.reset") }}
        </SButton>
      </div>
    </SPopover>
    <SButton
      type="cover"
      variant="ghost"
      circle
      :size="40"
      :disabled="!hasTrack"
      @click="delayLyric"
    >
      <template #icon><IconLucideMinus /></template>
    </SButton>
    <div class="h-px w-6 bg-cover/25 my-1" />
    <SPopover v-model:open="contentPopoverOpen" trigger="click" side="left" :side-offset="8" cover>
      <template #trigger>
        <SButton type="cover" variant="ghost" circle :size="40" :disabled="!hasLyric">
          <template #icon><IconLucideLanguages /></template>
        </SButton>
      </template>
      <div class="flex min-w-40 flex-col gap-3">
        <SCheckbox
          v-model:checked="settings.lyric.showTranslation"
          size="small"
          :disabled="!hasTranslation"
          :label="
            t(
              settings.lyric.showTranslation
                ? 'player.lyricActions.hideTranslation'
                : 'player.lyricActions.showTranslation',
            )
          "
        />
        <SCheckbox
          v-model:checked="settings.lyric.showRomanization"
          size="small"
          :disabled="!hasPronunciation"
          :label="
            t(
              settings.lyric.showRomanization
                ? 'player.lyricActions.hidePronunciation'
                : 'player.lyricActions.showPronunciation',
            )
          "
        />
      </div>
    </SPopover>
    <SButton type="cover" variant="ghost" circle :size="40" @click="settingsDialog.show('lyric')">
      <template #icon><IconLucideSettings2 /></template>
    </SButton>
    <CopyLyricsDialog v-model:open="copyDialogOpen" />
  </div>
</template>
