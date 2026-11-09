<script setup lang="ts">
import type { LyricMatchCandidate, LyricSearchSong, LyricSearchSource } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import { lyricMatchQuality, parseLyricSourceId } from "@shared/utils/lyricSource";
import { searchLyricVersions } from "@/services/lyric/sourceSearch";
import { toast } from "@/composables/useToast";
import { formatTime } from "@/utils/time";

const props = defineProps<{
  open: boolean;
  source: LyricSearchSource;
  track: Track;
  mode: "auto" | "search" | "id";
  /** 可切换的歌词来源列表，缺省时只保留当前来源 */
  sources?: LyricSearchSource[];
}>();
const emit = defineEmits<{
  "update:open": [value: boolean];
  saved: [track: Track, candidate: LyricMatchCandidate];
}>();
const { t } = useI18n();
const sourceFileOpen = ref(false);
/** 当前选中的来源，允许在对话框内切换 */
const activeSource = shallowRef<LyricSearchSource>(props.source);
/** 来源唯一标识，用于下拉选项 */
const sourceKey = (source: LyricSearchSource): string =>
  source.origin === "amll" ? `amll:${source.platform ?? ""}` : source.origin;
/** 下拉选项：标题 + 来源名 */
const sourceOptions = computed(() =>
  (props.sources?.length ? props.sources : [props.source]).map((source) => ({
    value: sourceKey(source),
    label:
      t(`lyricManager.matchSource.${source.origin}`) +
      (source.origin === "amll" && source.platform
        ? ` · ${t("lyricManager.matchSource." + source.platform)}`
        : ""),
  })),
);
/** 切换来源后清空旧结果并重新搜索 */
const onSourceChange = (value: string | number | boolean): void => {
  const next = (props.sources ?? [props.source]).find((source) => sourceKey(source) === String(value));
  if (!next || sourceKey(next) === sourceKey(activeSource.value)) return;
  activeSource.value = next;
  items.value = [];
  candidate.value = null;
  selected.value = null;
  total.value = null;
  offset.value = 0;
  if (props.mode !== "id" && keyword.value.trim()) void search(0);
};
watch(
  () => props.source,
  (next) => {
    if (next) activeSource.value = next;
  },
);
const keyword = ref(
  [props.track.title, props.track.artists.map((artist) => artist.name).join(" ")].join(" ").trim(),
);
const identifier = ref("");
const items = shallowRef<LyricSearchSong[]>([]);
const selected = shallowRef<LyricSearchSong | null>(null);
const candidate = shallowRef<LyricMatchCandidate | null>(null);
const loading = ref(false);
const lyricLoading = ref(false);
const saving = ref(false);
const offset = ref(0);
const total = ref<number | null>(null);
const hasMore = ref(false);
let searchToken = 0;
let lyricToken = 0;
const sourceLabel = computed(
  () =>
    t(`lyricManager.matchSource.${activeSource.value.origin}`) +
    (activeSource.value.origin === "amll" && activeSource.value.platform
      ? ` · ${t("lyricManager.matchSource." + activeSource.value.platform)}`
      : ""),
);

/**
 * 按所选曲目加载单个来源的歌词，旧请求不得覆盖后选版本
 * @param song - 来源曲目元数据或精确 ID
 */
const choose = async (song: LyricSearchSong | string): Promise<void> => {
  const token = ++lyricToken;
  selected.value = typeof song === "string" ? null : song;
  candidate.value = null;
  lyricLoading.value = true;
  try {
    const result = await window.api.lyrics.loadSourceVersion(toRaw(activeSource.value), song);
    if (token !== lyricToken) return;
    candidate.value = result;
    if (!result) toast.warning(t("lyricManager.versionHasNoLyrics"));
  } catch {
    if (token === lyricToken) toast.error(t("lyricManager.refetchFailed"));
  } finally {
    if (token === lyricToken) lyricLoading.value = false;
  }
};

/** 保存并请求父面板仅替换当前来源的版本 */
const save = async (): Promise<void> => {
  if (!candidate.value || saving.value) return;
  const token = lyricToken;
  const track = toRaw(props.track);
  saving.value = true;
  try {
    const saved = await window.api.lyrics.saveSourceVersion(track, toRaw(candidate.value));
    if (token !== lyricToken) return;
    emit("saved", track, saved);
    emit("update:open", false);
  } catch {
    toast.error(t("lyricManager.optimizeSaveFailed"));
  } finally {
    saving.value = false;
  }
};

/**
 * 搜索当前来源的指定页面，保留所有模糊命中供用户判断
 * @param nextOffset - 分页起点
 * @param automatic - 是否自动选取可靠的最佳版本
 */
const search = async (nextOffset = 0, automatic = false): Promise<void> => {
  if (!keyword.value.trim()) return;
  const token = ++searchToken;
  lyricToken++;
  candidate.value = null;
  selected.value = null;
  lyricLoading.value = false;
  loading.value = true;
  try {
    const page = await searchLyricVersions(activeSource.value, keyword.value.trim(), nextOffset);
    if (token !== searchToken) return;
    items.value = page.items;
    offset.value = nextOffset;
    hasMore.value = page.hasMore;
    total.value = page.total ?? null;
    if (automatic) {
      const best =
        page.items.find((song) => lyricMatchQuality(props.track, song) === "perfect") ??
        page.items.find((song) => lyricMatchQuality(props.track, song) === "high");
      if (!best) {
        toast.info(t("lyricManager.noReliableVersion"));
        return;
      }
      await choose(best);
      if (token === searchToken && candidate.value) await save();
    } else if (page.items[0]) await choose(page.items[0]);
  } catch {
    if (token === searchToken) toast.error(t("lyricManager.refreshFailed"));
  } finally {
    if (token === searchToken) loading.value = false;
  }
};

/** 仅解析当前来源的官方链接或 ID，并在保存前先展示歌词 */
const parseIdentifier = async (): Promise<void> => {
  const id = parseLyricSourceId(activeSource.value, identifier.value);
  if (!id) {
    toast.warning(t("lyricManager.invalidSourceId"));
    return;
  }
  await choose(id);
};

onMounted(() => {
  if (props.mode !== "id") void search(0, props.mode === "auto");
});
onBeforeUnmount(() => {
  searchToken++;
  lyricToken++;
});
</script>

<template>
  <SDialog
    :open="open"
    :title="t(mode === 'id' ? 'lyricManager.importVersionId' : 'lyricManager.chooseOnlineVersion')"
    variant="settings"
    width="min(1200px,94vw)"
    height="min(820px,90vh)"
    :content-style="{
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      padding: '16px',
    }"
    @update:open="emit('update:open', $event)"
  >
    <div class="mb-4 shrink-0">
      <div class="flex items-center gap-3">
        <h3 class="m-0 min-w-0 text-xl font-semibold truncate">{{ sourceLabel }}</h3>
        <SSelect
          v-if="sourceOptions.length > 1"
          :model-value="sourceKey(activeSource)"
          :options="sourceOptions"
          class="w-52 shrink-0"
          @update:model-value="onSourceChange"
        />
      </div>
      <p class="mt-1 text-xs text-on-surface-variant/65">
        {{ track.title }} · {{ track.artists.map((artist) => artist.name).join(" / ") }}
      </p>
      <div v-if="mode === 'id'" class="mt-3 flex gap-2">
        <SInput
          v-model="identifier"
          class="flex-1"
          :placeholder="t('lyricManager.sourceIdPlaceholder')"
          @keydown.enter="parseIdentifier"
        />
        <SButton variant="secondary" :loading="lyricLoading" @click="parseIdentifier">
          {{ t("lyricManager.parseVersion") }}
        </SButton>
      </div>
      <div v-else class="mt-3 flex gap-2">
        <SInput
          v-model="keyword"
          class="flex-1"
          :placeholder="t('lyricManager.sourceSearchPlaceholder')"
          @keydown.enter="search(0)"
        />
        <SButton variant="secondary" :loading="loading" @click="search(0)">
          {{ t("common.search") }}
        </SButton>
      </div>
    </div>
    <div class="source-search-grid min-h-0 flex-1" :class="{ 'id-mode': mode === 'id' }">
      <div v-if="mode !== 'id'" class="flex min-h-0 flex-col gap-2">
        <SVirtualList
          class="min-h-0 flex-1"
          :items="items"
          :item-height="118"
          :get-item-key="(song) => song.id"
        >
          <template #default="{ item }">
            <button
              class="mb-2 w-full rounded-xl border border-solid p-3 text-left cursor-pointer"
              :class="
                selected?.id === item.id
                  ? 'border-primary/50 bg-primary/10'
                  : 'border-outline-variant/20 hover:bg-on-surface/5'
              "
              :disabled="saving"
              @click="choose(item)"
            >
              <div class="flex justify-between gap-2">
                <span class="font-semibold truncate">{{ item.title }}</span>
                <STag
                  size="tiny"
                  :type="lyricMatchQuality(track, item) === 'perfect' ? 'success' : 'default'"
                >
                  {{ t("lyricManager.matchQuality." + lyricMatchQuality(track, item)) }}
                </STag>
              </div>
              <div class="mt-1 text-xs truncate text-on-surface-variant/70">
                {{ item.artists.join(" / ") }}
              </div>
              <div class="mt-1 text-xs truncate text-on-surface-variant/55">{{ item.album }}</div>
              <div class="mt-2 text-xs tabular-nums text-on-surface-variant/55">
                {{ formatTime(item.duration) }} · ID: {{ item.id }}
              </div>
            </button>
          </template>
          <template #empty>
            <div class="p-6 text-center text-on-surface-variant/60">
              {{ t(loading ? "lyricManager.matching" : "lyricManager.noMatchResults") }}
            </div>
          </template>
        </SVirtualList>
        <div
          class="flex shrink-0 items-center justify-between gap-2 text-xs text-on-surface-variant/65"
        >
          <span>{{ t("lyricManager.searchResultCount", { count: total ?? items.length }) }}</span>
          <div class="flex gap-1">
            <SButton
              variant="ghost"
              size="tiny"
              :disabled="offset === 0 || loading"
              @click="search(Math.max(0, offset - 50))"
            >
              <IconLucideChevronLeft />
            </SButton>
            <SButton
              variant="ghost"
              size="tiny"
              :disabled="!hasMore || loading"
              @click="search(offset + 50)"
            >
              <IconLucideChevronRight />
            </SButton>
          </div>
        </div>
      </div>
      <LyricCandidateDetails
        v-if="candidate"
        :candidate="candidate"
        :track="track"
        :source-label="sourceLabel"
        :in-use="false"
        :selected="false"
        :loading="false"
        :can-delete="false"
        :source-url="null"
        :search-preview="true"
        @edit="sourceFileOpen = true"
      />
      <div
        v-else
        class="flex min-h-60 items-center justify-center rounded-xl border border-solid border-outline-variant/20 text-on-surface-variant/60"
      >
        {{
          t(
            lyricLoading
              ? "lyricManager.matching"
              : mode === "id"
                ? "lyricManager.sourceIdHint"
                : "lyricManager.chooseVersion",
          )
        }}
      </div>
    </div>
    <template #footer>
      <SButton variant="secondary" @click="emit('update:open', false)">
        {{ t("common.close") }}
      </SButton>
      <SButton
        type="primary"
        :disabled="!candidate || lyricLoading || loading"
        :loading="saving"
        @click="save"
      >
        {{ t("lyricManager.saveSelectedVersion") }}
      </SButton>
    </template>
  </SDialog>
  <SDialog
    v-model:open="sourceFileOpen"
    :title="t('lyricManager.optimize')"
    width="min(760px,90vw)"
  >
    <SInput
      type="textarea"
      :model-value="candidate?.content ?? ''"
      readonly
      :rows="18"
      class="font-mono"
    />
    <template #footer>
      <SButton variant="secondary" @click="sourceFileOpen = false">{{ t("common.close") }}</SButton>
    </template>
  </SDialog>
</template>

<style scoped>
.source-search-grid {
  display: grid;
  grid-template-columns: minmax(230px, 0.8fr) minmax(0, 1.4fr);
  gap: 12px;
}
.source-search-grid.id-mode {
  grid-template-columns: minmax(0, 1fr);
}
@media (max-width: 700px) {
  .source-search-grid {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 220px minmax(350px, 1fr);
    overflow-y: auto;
  }
}
</style>
