<script setup lang="ts">
import type { Track } from "@shared/types/player";
import type { ManagedLyricSummary } from "@shared/types/lyrics";
import { useStreamingStore } from "@/stores/streaming";
import { useLibraryStore } from "@/stores/library";
import { useMediaStore } from "@/stores/media";
import { queue } from "@/stores/queue";
import { dialog } from "@/composables/useDialog";
import { toast } from "@/composables/useToast";
const props = defineProps<{ selected: Track | null }>();
const emit = defineEmits<{ select: [track: Track] }>();
const { t } = useI18n();
const library = useLibraryStore();
const streaming = useStreamingStore();
const media = useMediaStore();
const records = shallowRef<ManagedLyricSummary[]>([]);
const query = ref("");
const filter = ref("all");
const sort = ref("recent");
const loading = ref(false);
let requestId = 0;
let unsubscribe: (() => void) | undefined;
const tracks = computed(() => {
  const known = new Map<
    string,
    { key: string; track: Track | null; record?: ManagedLyricSummary }
  >();
  for (const record of records.value) {
    const key = record.trackSource + ":" + record.trackId;
    known.set(key, { key, track: record.track ?? null, record });
  }
  for (const collection of [
    library.tracks,
    streaming.songs,
    queue.value,
    media.track ? [media.track] : [],
  ]) {
    for (const track of collection) {
      const key = track.source + ":" + track.id;
      known.set(key, { ...known.get(key), key, track });
    }
  }
  return [...known.values()];
});
const filtered = computed(() => {
  const search = query.value.trim().toLocaleLowerCase();
  return tracks.value
    .filter((item) => {
      if (filter.value === "managed" && !item.record) return false;
      if (filter.value === "unmanaged" && item.record) return false;
      return (
        !search ||
        [
          item.track?.title,
          item.track?.artists.map((a) => a.name).join(" / "),
          item.track?.album?.name,
          item.record?.filename,
          item.key,
        ].some((text) => text?.toLocaleLowerCase().includes(search))
      );
    })
    .sort((a, b) =>
      sort.value === "title"
        ? (a.track?.title ?? a.key).localeCompare(b.track?.title ?? b.key)
        : (b.record?.importedAt ?? 0) - (a.record?.importedAt ?? 0),
    );
});
/** 只刷新摘要，关闭面板后丢弃返回结果 */
const load = async (): Promise<void> => {
  const token = ++requestId;
  loading.value = true;
  try {
    const result = await window.api.lyrics.listManaged();
    if (token !== requestId) return;
    records.value = result;
    if (!props.selected) {
      const first =
        tracks.value.find(
          (item) =>
            item.track?.source === media.track?.source && item.track?.id === media.track?.id,
        ) ?? tracks.value.find((item) => item.track);
      if (first?.track) emit("select", first.track);
    }
  } catch {
    toast.error(t("lyricManager.refreshFailed"));
  } finally {
    if (token === requestId) loading.value = false;
  }
};
/** 批量导入有元数据的 TTML */
const importDirectory = async (): Promise<void> => {
  try {
    await window.api.lyrics.importNeteaseTtmlDirectory();
    await load();
  } catch {
    toast.error(t("lyricManager.importFailed"));
  }
};
/** 确认后迁移手动歌词目录 */
const migrateDirectory = async (): Promise<void> => {
  try {
    const directory = await window.api.lyrics.pickManagedDir();
    if (
      !directory ||
      !(await dialog.confirm({
        title: t("lyricManager.migrateDirectory"),
        content: t("lyricManager.migrateDirectoryDescription", { directory }),
        type: "warning",
      }))
    )
      return;
    const result = await window.api.lyrics.moveManagedDir(directory);
    if (!result.ok) toast.error(t("lyricManager.migrateDirectoryFailed"));
    await load();
  } catch {
    toast.error(t("lyricManager.migrateDirectoryFailed"));
  }
};
/** 删除没有曲目信息的孤立记录
 * @param record - 无法关联的歌词摘要
 */
const removeOrphan = async (record: ManagedLyricSummary): Promise<void> => {
  if (
    !(await dialog.confirm({
      title: t("lyricManager.deleteUnmatchedTitle"),
      content: t("lyricManager.deleteUnmatchedDescription", {
        filename: record.filename ?? record.trackId,
      }),
      type: "warning",
    }))
  )
    return;
  try {
    await window.api.lyrics.removeManaged({
      source: record.trackSource as Track["source"],
      id: record.trackId,
    });
    await load();
  } catch {
    toast.error(t("lyricManager.deleteVersionFailed"));
  }
};
onMounted(() => {
  void load();
  unsubscribe = window.api.lyrics.onManagedChanged(() => void load());
});
onBeforeUnmount(() => {
  requestId++;
  unsubscribe?.();
  records.value = [];
});
</script>
<template>
  <section
    class="flex min-h-0 flex-col rounded-xl border border-solid border-outline-variant/15 bg-surface-panel p-3 gap-3"
  >
    <div class="flex items-center justify-between gap-2">
      <h3 class="m-0 text-base font-semibold">{{ t("lyricManager.tracks") }}</h3>
      <STag size="tiny">{{ tracks.length }}</STag>
      <SButton
        variant="ghost"
        circle
        size="small"
        :loading="loading"
        :title="t('common.refreshCache')"
        @click="load"
      >
        <template #icon><IconLucideRefreshCw /></template>
      </SButton>
    </div>
    <SInput v-model="query" :placeholder="t('lyricManager.searchTrackPlaceholder')">
      <template #prefix><IconLucideSearch class="size-4" /></template>
    </SInput>
    <div class="flex gap-2">
      <SSelect
        v-model="filter"
        class="min-w-0 flex-1"
        :options="[
          { value: 'all', label: t('lyricManager.allTracks') },
          { value: 'managed', label: t('lyricManager.withVersions') },
          { value: 'unmanaged', label: t('lyricManager.withoutVersions') },
        ]"
      />
      <SSelect
        v-model="sort"
        class="min-w-0 flex-1"
        :options="[
          { value: 'recent', label: t('lyricManager.recentFirst') },
          { value: 'title', label: t('lyricManager.titleOrder') },
        ]"
      />
    </div>
    <SVirtualList
      class="min-h-0 flex-1"
      :items="filtered"
      :item-height="104"
      item-fixed
      :get-item-key="(item) => item.key"
    >
      <template #default="{ item }">
        <div
          class="mb-2 flex h-24 min-w-0 rounded-xl border border-solid transition-colors"
          :class="
            item.track?.source === selected?.source && item.track?.id === selected?.id
              ? 'border-primary/50 bg-primary/8'
              : 'border-outline-variant/15 hover:bg-on-surface/5'
          "
        >
          <button
            v-if="item.track"
            class="min-w-0 flex-1 cursor-pointer rounded-xl border-none bg-transparent p-3 text-left text-on-surface focus-visible:ring-2 focus-visible:ring-primary/40"
            @click="emit('select', item.track)"
          >
            <div class="truncate font-medium">{{ item.track.title }}</div>
            <div class="mt-1 truncate text-xs text-on-surface-variant/65">
              {{ item.track.artists.map((a) => a.name).join(" / ") }}
            </div>
            <div class="mt-2 text-xs text-on-surface-variant/55">
              {{ t("lyricManager.versionCount", { count: item.record?.versionCount ?? 0 }) }}
            </div>
          </button>
          <div v-else class="flex min-w-0 flex-1 items-center gap-1 p-3">
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm">{{ item.record?.filename ?? item.key }}</div>
              <div class="mt-1 text-xs text-on-surface-variant/60">
                {{ t("lyricManager.unmatched") }}
              </div>
            </div>
            <SButton
              variant="ghost"
              circle
              :title="t('common.delete')"
              @click="removeOrphan(item.record!)"
            >
              <template #icon><IconLucideTrash2 /></template>
            </SButton>
          </div>
        </div>
      </template>
      <template #empty>
        <div class="p-6 text-center text-sm text-on-surface-variant/60">
          {{ t("lyricManager.noTracks") }}
        </div>
      </template>
    </SVirtualList>
    <div class="flex flex-wrap gap-2 border-t border-solid border-outline-variant/15 pt-3">
      <SButton variant="secondary" size="small" @click="importDirectory">
        {{ t("lyricManager.importNeteaseTtml") }}
      </SButton>
      <SButton variant="ghost" size="small" @click="migrateDirectory">
        {{ t("lyricManager.migrateDirectory") }}
      </SButton>
    </div>
  </section>
</template>
