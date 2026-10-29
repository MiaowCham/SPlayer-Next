<script setup lang="ts">
import type { LyricMatchCandidate } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import { parseLyric } from "@/utils/lyric/parse";
import { formatTime } from "@/utils/time";
import { toast } from "@/composables/useToast";
const props = defineProps<{
  candidate: LyricMatchCandidate;
  track: Track;
  sourceLabel: string;
  inUse: boolean;
  selected: boolean;
  loading: boolean;
  canDelete: boolean;
  sourceUrl: string | null;
}>();
const emit = defineEmits<{ confirm: []; search: []; edit: []; remove: []; source: [] }>();
const { t, locale } = useI18n();
const preview = computed(() => {
  try {
    return {
      lines: parseLyric(props.candidate, props.candidate.format, locale.value),
      error: false,
    };
  } catch {
    return { lines: [], error: true };
  }
});
const hasWords = computed(() => preview.value.lines.some((line) => line.words.length > 1));
const hasTranslation = computed(() => preview.value.lines.some((line) => line.translatedLyric));
const effectOpen = ref(false);
const effectPlaying = ref(true);
const time = ref(0);
const visibility = useDocumentVisibility();
const engine = ref<{ setCurrentTime(time: number, seeking?: boolean): void }>();
const duration = computed(() =>
  Math.max(
    1,
    props.track.duration ||
      preview.value.lines.reduce((end, line) => Math.max(end, line.endTime), 0),
  ),
);
/** 复制当前版本的原始内容 */
const copy = async (): Promise<void> => {
  try {
    await navigator.clipboard.writeText(props.candidate.content);
  } catch {
    toast.error(t("lyricManager.copyFailed"));
  }
};
/** 定位效果预览，不修改实际播放器
 * @param value - 预览时间
 */
const seek = (value: number): void => {
  time.value = value;
  engine.value?.setCurrentTime(value, true);
};
const { pause, resume } = useRafFn(
  ({ delta }) => {
    time.value = (time.value + delta) % duration.value;
    engine.value?.setCurrentTime(time.value);
  },
  { immediate: false },
);
watch([effectOpen, effectPlaying, visibility], ([open, playing, visible]) => {
  if (open && playing && visible === "visible") resume();
  else pause();
});
watch(
  () => props.candidate.id,
  () => {
    effectOpen.value = false;
    time.value = 0;
  },
);
onBeforeUnmount(pause);
</script>
<template>
  <section
    class="flex min-h-0 min-w-0 flex-col rounded-xl border border-solid border-outline-variant/15 bg-surface-panel"
  >
    <div class="shrink-0 p-4 border-b border-solid border-outline-variant/15">
      <h3 class="m-0 text-xl font-semibold">{{ sourceLabel }}</h3>
      <div class="mt-2 flex flex-wrap gap-1.5">
        <STag v-if="inUse" type="primary" size="small">{{ t("lyricManager.inUse") }}</STag>
        <STag size="small">{{ candidate.format.toUpperCase() }}</STag>
        <STag size="small">
          {{ t(hasWords ? "lyricManager.wordTiming" : "lyricManager.lineTiming") }}
        </STag>
        <STag v-if="hasTranslation" type="primary" size="small">
          {{ t("lyricManager.translationTag") }}
        </STag>
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        <SButton
          type="primary"
          :disabled="selected || !candidate.content"
          :loading="loading"
          @click="emit('confirm')"
        >
          <template #icon><IconLucideCheckCircle2 /></template>
          {{ t(selected ? "lyricManager.selected" : "lyricManager.confirmVersion") }}
        </SButton>
        <SButton variant="secondary" @click="emit('search')">
          <template #icon><IconLucideSearch /></template>
          {{ t("lyricManager.customSearch") }}
        </SButton>
        <SPopover side="bottom" align="end">
          <template #trigger>
            <SButton variant="secondary" circle :title="t('lyricManager.moreActions')">
              <template #icon><IconLucideEllipsis /></template>
            </SButton>
          </template>
          <div class="flex min-w-36 flex-col gap-1">
            <SButton variant="ghost" @click="emit('edit')">
              {{ t("lyricManager.optimize") }}
            </SButton>
            <SButton v-if="sourceUrl" variant="ghost" @click="emit('source')">
              {{ t("lyricManager.openSource") }}
            </SButton>
            <SButton v-if="canDelete" variant="ghost" @click="emit('remove')">
              {{ t("lyricManager.deleteVersionTitle") }}
            </SButton>
          </div>
        </SPopover>
      </div>
    </div>
    <div class="shrink-0 border-b border-solid border-outline-variant/15 p-4">
      <div class="text-xs font-medium text-on-surface-variant/65">
        {{ t("lyricManager.sourceDetails") }}
      </div>
      <div class="mt-2 font-semibold leading-snug break-words">{{ track.title }}</div>
      <div class="mt-1 text-xs text-on-surface-variant/70">
        {{ track.artists.map((artist) => artist.name).join(" / ") }}
      </div>
      <div class="mt-1 truncate text-xs text-on-surface-variant/55">{{ track.album?.name }}</div>
      <dl class="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
        <dt class="text-on-surface-variant/55">{{ t("lyricManager.trackId") }}</dt>
        <dd class="m-0 truncate">{{ candidate.extra?.id || candidate.extra?.mid || track.id }}</dd>
        <dt class="text-on-surface-variant/55">{{ t("lyricManager.filename") }}</dt>
        <dd class="m-0 break-all">{{ candidate.filename }}</dd>
        <template v-if="candidate.importedAt">
          <dt class="text-on-surface-variant/55">{{ t("lyricManager.updatedAt") }}</dt>
          <dd class="m-0">{{ new Date(candidate.importedAt).toLocaleString() }}</dd>
        </template>
      </dl>
    </div>
    <div class="flex shrink-0 items-center justify-between gap-2 px-4 pt-3">
      <h4 class="m-0 font-medium">{{ t("lyricManager.preview") }}</h4>
      <div class="flex gap-1">
        <SButton
          variant="ghost"
          size="small"
          :disabled="preview.error || !preview.lines.length"
          @click="
            effectOpen = true;
            seek(preview.lines[0]?.startTime ?? 0);
          "
        >
          <template #icon><IconLucidePlay /></template>
          {{ t("lyricManager.effectPreview") }}
        </SButton>
        <SButton
          variant="ghost"
          circle
          size="small"
          :title="t('lyricManager.copySource')"
          @click="copy"
        >
          <template #icon><IconLucideCopy /></template>
        </SButton>
      </div>
    </div>
    <SVirtualList
      class="min-h-0 flex-1 px-4 py-2"
      :items="preview.lines"
      :item-height="84"
      item-fixed
    >
      <template #default="{ item }">
        <div class="flex h-21 gap-3 py-2">
          <time class="w-16 shrink-0 pt-1 text-xs tabular-nums text-on-surface-variant/55">
            {{ formatTime(item.startTime) }}
          </time>
          <div class="min-w-0 flex-1">
            <div class="line-clamp-2 font-medium">
              {{ item.words.map((word) => word.word).join("") }}
            </div>
            <div
              v-if="item.translatedLyric"
              class="mt-1 truncate text-xs text-on-surface-variant/65"
            >
              {{ item.translatedLyric }}
            </div>
            <div v-if="item.romanLyric" class="truncate text-xs text-on-surface-variant/55">
              {{ item.romanLyric }}
            </div>
          </div>
        </div>
      </template>
      <template #empty>
        <div class="p-6 text-center text-on-surface-variant/60">
          {{ t(preview.error ? "lyricManager.previewFailed" : "lyricManager.noMatchResults") }}
        </div>
      </template>
    </SVirtualList>
  </section>
  <SDialog
    v-model:open="effectOpen"
    :title="t('lyricManager.effectPreview')"
    variant="settings"
    width="min(860px,94vw)"
    height="min(720px,85vh)"
    :content-style="{
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }"
    destroy-on-close
  >
    <Lyrics
      v-if="effectOpen"
      ref="engine"
      class="min-h-0 flex-1 text-3xl"
      :lyric-lines="preview.lines"
      :playing="effectPlaying"
      :initial-time="time"
      @ready="seek(time)"
    />
    <div class="flex shrink-0 items-center gap-3 pt-3">
      <SButton
        variant="secondary"
        circle
        :title="t(effectPlaying ? 'lyricManager.pausePreview' : 'lyricManager.playPreview')"
        @click="effectPlaying = !effectPlaying"
      >
        <template #icon>
          <IconLucidePause v-if="effectPlaying" />
          <IconLucidePlay v-else />
        </template>
      </SButton>
      <SSlider
        class="flex-1"
        :model-value="time"
        :min="0"
        :max="duration"
        :step="1"
        @update:model-value="seek"
      />
      <time class="text-xs tabular-nums">{{ formatTime(time) }}</time>
    </div>
  </SDialog>
</template>
