<script setup lang="ts">
import type { LyricMatchCandidate } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import CopyLyricsDialog from "@/components/modals/CopyLyricsDialog.vue";
import { buildClipboardLyric } from "@/utils/lyric/clipboard";
import { lyricMatchQuality, lyricSourceOffset } from "@shared/utils/lyricSource";
import { parseLyric } from "@/utils/lyric/parse";
import { formatTime } from "@/utils/time";
import { useCopyText } from "@/composables/useCopyText";
const props = defineProps<{
  candidate: LyricMatchCandidate;
  track: Track;
  sourceLabel: string;
  inUse: boolean;
  selected: boolean;
  loading: boolean;
  canDelete: boolean;
  sourceUrl: string | null;
  searchPreview?: boolean;
}>();
const emit = defineEmits<{
  confirm: [];
  search: [mode: "auto" | "search" | "id"];
  edit: [];
  remove: [];
  source: [];
  refetch: [];
}>();
const { t, locale } = useI18n();
const { copy: copyText } = useCopyText();
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
const calibrating = ref(false);
const copyOpen = ref(false);
const copyMenuOpen = ref(false);
const actionsOpen = ref(false);
const searchMenuOpen = ref(false);
const versionOffset = ref<number | null>(null);
const matchQuality = computed(() => lyricMatchQuality(props.track, props.candidate.sourceTrack));
const sourceOffset = computed(() => lyricSourceOffset(props.candidate));
watch(
  [() => props.candidate.id, effectOpen],
  async () => {
    const id = props.candidate.id;
    versionOffset.value = null;
    try {
      const value = await window.api.lyrics.getVersionOffset(
        toRaw(props.track),
        toRaw(props.candidate),
      );
      if (props.candidate.id === id) versionOffset.value = value;
    } catch {
      /* 面板仍可查看未校准的版本 */
    }
  },
  { immediate: true },
);

/**
 * 复制当前版本的正文，按所选格式附加翻译或时间轴
 * @param translation - 是否附带翻译
 * @param timestamps - 是否附带行时间戳
 */
const copy = async (translation: boolean, timestamps: boolean): Promise<void> => {
  copyMenuOpen.value = false;
  await copyText(buildClipboardLyric(preview.value.lines, translation, timestamps));
};
/**
 * 打开当前版本的独立试听或偏移校准
 * @param adjustOffset - 是否显示偏移编辑
 */
const openPreview = (adjustOffset: boolean): void => {
  calibrating.value = adjustOffset;
  effectOpen.value = true;
};
watch(
  () => props.candidate.id,
  () => {
    effectOpen.value = false;
    copyOpen.value = false;
    copyMenuOpen.value = false;
    actionsOpen.value = false;
  },
);
</script>
<template>
  <section
    class="flex min-h-0 min-w-0 flex-col rounded-xl border border-solid border-outline-variant/15 bg-surface-panel"
  >
    <div class="shrink-0 p-4 border-b border-solid border-outline-variant/15">
      <h3 class="m-0 text-xl font-semibold">{{ sourceLabel }}</h3>
      <div class="mt-2 flex flex-wrap gap-1.5">
        <STag size="small" :type="matchQuality === 'perfect' ? 'success' : 'default'">
          {{ t("lyricManager.matchQuality." + matchQuality) }}
        </STag>
        <STag size="small">{{ t("lyricManager.sourceOffset", { value: sourceOffset }) }}</STag>
        <STag v-if="versionOffset !== null" size="small">
          {{ t("lyricManager.versionOffsetTag", { value: versionOffset }) }}
        </STag>
        <STag v-if="inUse" type="primary" size="small">{{ t("lyricManager.inUse") }}</STag>
        <STag size="small">{{ candidate.format.toUpperCase() }}</STag>
        <STag size="small">
          {{ t(hasWords ? "lyricManager.wordTiming" : "lyricManager.lineTiming") }}
        </STag>
        <STag v-if="hasTranslation" type="primary" size="small">
          {{ t("lyricManager.translationTag") }}
        </STag>
      </div>
      <div v-if="!searchPreview" class="mt-4 flex flex-wrap gap-2">
        <SButton
          type="primary"
          :disabled="selected || !candidate.content"
          :loading="loading"
          @click="emit('confirm')"
        >
          <template #icon><IconLucideCheckCircle2 /></template>
          {{ t(selected ? "lyricManager.selected" : "lyricManager.confirmVersion") }}
        </SButton>
        <SPopover v-model:open="searchMenuOpen" side="bottom" align="start">
          <template #trigger>
            <SButton
              variant="secondary"
              :disabled="candidate.origin === 'manual'"
              :title="
                candidate.origin === 'manual' ? t('lyricManager.manualSourceSearchHint') : undefined
              "
            >
              <template #icon><IconLucideSearch /></template>
              {{ t("lyricManager.replaceVersion") }}
              <IconLucideChevronDown class="size-4" />
            </SButton>
          </template>
          <div class="flex min-w-48 flex-col gap-1" @click="searchMenuOpen = false">
            <SButton variant="ghost" @click="emit('search', 'auto')">
              {{ t("lyricManager.autoReplaceVersion") }}
            </SButton>
            <SButton variant="ghost" @click="emit('search', 'search')">
              {{ t("lyricManager.searchSelectVersion") }}
            </SButton>
            <SButton variant="ghost" @click="emit('search', 'id')">
              {{ t("lyricManager.importVersionId") }}
            </SButton>
          </div>
        </SPopover>
        <SPopover v-model:open="actionsOpen" side="bottom" align="end">
          <template #trigger>
            <SButton variant="secondary" circle :title="t('lyricManager.moreActions')">
              <template #icon><IconLucideEllipsis /></template>
            </SButton>
          </template>
          <div class="flex min-w-44 flex-col gap-1" @click="actionsOpen = false">
            <SButton variant="ghost" :disabled="loading" @click="emit('refetch')">
              {{ t("lyricManager.refetchVersion") }}
            </SButton>
            <SButton variant="ghost" @click="emit('edit')">
              {{ t("lyricManager.optimize") }}
            </SButton>
            <SButton v-if="sourceUrl" variant="ghost" @click="emit('source')">
              {{ t("lyricManager.openSource") }}
            </SButton>
            <SButton
              variant="ghost"
              :disabled="!canDelete || loading"
              :title="
                !canDelete
                  ? t(inUse ? 'lyricManager.inUseDeleteHint' : 'lyricManager.readOnlyVersion')
                  : undefined
              "
              @click="emit('remove')"
            >
              {{ t("lyricManager.deleteVersion") }}
            </SButton>
          </div>
        </SPopover>
      </div>
    </div>
    <div class="shrink-0 border-b border-solid border-outline-variant/15 p-4">
      <div class="text-xs font-medium text-on-surface-variant/65">
        {{ t("lyricManager.sourceDetails") }}
      </div>
      <div class="mt-2 font-semibold leading-snug break-words">
        {{ candidate.sourceTrack?.title || candidate.filename }}
      </div>
      <div class="mt-1 text-xs text-on-surface-variant/70">
        {{ candidate.sourceTrack?.artists.join(" / ") || t("lyricManager.sourceMetadataUnknown") }}
      </div>
      <div class="mt-1 truncate text-xs text-on-surface-variant/55">
        {{ candidate.sourceTrack?.album }}
      </div>
      <dl class="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
        <dt class="text-on-surface-variant/55">{{ t("lyricManager.trackId") }}</dt>
        <dd class="m-0 truncate">
          {{
            candidate.sourceTrack?.id ||
            candidate.extra?.id ||
            candidate.extra?.mid ||
            candidate.extra?.hash ||
            "—"
          }}
        </dd>
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
      <div class="flex flex-wrap justify-end gap-1">
        <SButton v-if="searchPreview" variant="ghost" size="small" @click="emit('edit')">
          {{ t("lyricManager.optimize") }}
        </SButton>
        <SButton
          variant="ghost"
          size="small"
          :disabled="preview.error || !preview.lines.length"
          @click="openPreview(false)"
        >
          <template #icon><IconLucidePlay /></template>
          {{ t("lyricManager.effectPreview") }}
        </SButton>
        <SButton
          variant="ghost"
          size="small"
          :disabled="preview.error || !preview.lines.length"
          @click="openPreview(true)"
        >
          <template #icon><IconLucideSlidersHorizontal /></template>
          {{ t("lyricManager.adjustOffset") }}
        </SButton>
        <SPopover v-model:open="copyMenuOpen" side="bottom" align="end">
          <template #trigger>
            <SButton
              variant="ghost"
              circle
              size="small"
              :disabled="preview.error || !preview.lines.length"
              :title="t('player.copyLyric.copy')"
            >
              <template #icon><IconLucideCopy /></template>
            </SButton>
          </template>
          <div class="flex min-w-48 flex-col gap-1">
            <SButton
              variant="ghost"
              @click="
                copyOpen = true;
                copyMenuOpen = false;
              "
            >
              {{ t("lyricManager.selectCopy") }}
            </SButton>
            <div class="my-1 border-t border-solid border-outline-variant/20" />
            <SButton variant="ghost" @click="copy(false, false)">
              {{ t("lyricManager.copyText") }}
            </SButton>
            <SButton variant="ghost" @click="copy(true, false)">
              {{ t("lyricManager.copyTextTranslation") }}
            </SButton>
            <div class="my-1 border-t border-solid border-outline-variant/20" />
            <SButton variant="ghost" @click="copy(false, true)">
              {{ t("lyricManager.copyTimedText") }}
            </SButton>
            <SButton variant="ghost" @click="copy(true, true)">
              {{ t("lyricManager.copyTimedTranslation") }}
            </SButton>
          </div>
        </SPopover>
      </div>
    </div>
    <SVirtualList class="min-h-0 flex-1 px-4 py-2" :items="preview.lines" :item-height="48">
      <template #default="{ item }">
        <div class="flex gap-3 py-1.5">
          <time class="w-16 shrink-0 pt-1 text-xs tabular-nums text-on-surface-variant/55">
            {{ formatTime(item.startTime) }}
          </time>
          <div class="min-w-0 flex-1">
            <div class="line-clamp-2 font-medium">
              {{ item.words.map((word) => word.word).join("") }}
            </div>
            <div
              v-if="item.translatedLyric"
              class="mt-0.5 whitespace-pre-wrap break-words text-xs leading-4 text-on-surface-variant/65"
            >
              {{ item.translatedLyric }}
            </div>
            <div
              v-if="item.romanLyric"
              class="whitespace-pre-wrap break-words text-xs leading-4 text-on-surface-variant/55"
            >
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
  <LyricPreviewDialog
    v-if="effectOpen"
    :key="candidate.id"
    v-model:open="effectOpen"
    :calibrating="calibrating"
    :track="track"
    :candidate="candidate"
    :lines="preview.lines"
  />
  <CopyLyricsDialog
    v-if="copyOpen"
    v-model:open="copyOpen"
    :lyric-lines="preview.lines"
    :track="track"
    :raw-content="candidate.content"
  />
</template>
