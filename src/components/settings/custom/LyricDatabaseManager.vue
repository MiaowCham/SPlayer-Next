<script setup lang="ts">
import { dialog } from "@/composables/useDialog";
import { toast } from "@/composables/useToast";
import { useLyricTrackManagerDialog } from "@/composables/useLyricTrackManagerDialog";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const trackManager = useLyricTrackManagerDialog();
const open = ref(false);
const loading = ref(false);
const records = ref<Awaited<ReturnType<typeof window.api.lyrics.listManaged>>>([]);
const reopenAfterTrackManager = ref(false);
let unsubscribeManagedChanged: (() => void) | undefined;

const load = async (): Promise<void> => {
  loading.value = true;
  try {
    records.value = await window.api.lyrics.listManaged();
  } finally {
    loading.value = false;
  }
};

const importTtml = async (): Promise<void> => {
  loading.value = true;
  try {
    await window.api.lyrics.importNeteaseTtmlDirectory();
    await load();
  } finally {
    loading.value = false;
  }
};

/** 选择新目录并迁移现有手动导入歌词。 */
const migrateDirectory = async (): Promise<void> => {
  const directory = await window.api.lyrics.pickManagedDir();
  if (!directory) return;
  const confirmed = await dialog.confirm({
    title: t("lyricManager.migrateDirectory"),
    content: t("lyricManager.migrateDirectoryDescription", { directory }),
    type: "warning",
  });
  if (!confirmed) return;
  loading.value = true;
  try {
    const result = await window.api.lyrics.moveManagedDir(directory);
    if (!result.ok) {
      toast.error(t("lyricManager.migrateDirectoryFailed"));
      return;
    }
    await load();
  } catch {
    toast.error(t("lyricManager.migrateDirectoryFailed"));
  } finally {
    loading.value = false;
  }
};

/** 关闭全局管理器后再打开单曲面板，避免嵌套遮罩拦截操作。 */
const manageTrack = async (
  track: NonNullable<(typeof records.value)[number]["track"]>,
): Promise<void> => {
  reopenAfterTrackManager.value = true;
  open.value = false;
  await nextTick();
  trackManager.show(track, "database");
};

/** 删除无法匹配到曲目数据的孤立歌词。 */
const deleteUnmatchedLyric = async (record: (typeof records.value)[number]): Promise<void> => {
  const confirmed = await dialog.confirm({
    title: t("lyricManager.deleteUnmatchedTitle"),
    content: t("lyricManager.deleteUnmatchedDescription", {
      filename: record.filename || record.trackId,
    }),
    type: "warning",
  });
  if (!confirmed) return;
  loading.value = true;
  try {
    await window.api.lyrics.removeManaged({
      source: record.trackSource as Parameters<typeof window.api.lyrics.removeManaged>[0]["source"],
      id: record.trackId,
    });
    await load();
  } catch {
    toast.error(t("lyricManager.deleteLyricFailed"));
  } finally {
    loading.value = false;
  }
};

const formatImportedAt = (value: number): string => new Date(value).toLocaleString();

watch(open, (value) => {
  if (value) {
    void load();
    unsubscribeManagedChanged = window.api.lyrics.onManagedChanged(() => void load());
  } else {
    unsubscribeManagedChanged?.();
    unsubscribeManagedChanged = undefined;
  }
});

watch(
  () => trackManager.open.value,
  (value) => {
    if (value || !reopenAfterTrackManager.value) return;
    reopenAfterTrackManager.value = false;
    open.value = true;
  },
);

onUnmounted(() => unsubscribeManagedChanged?.());
</script>

<template>
  <SButton variant="secondary" @click="open = true">
    {{ t("lyricManager.openDatabase") }}
  </SButton>
  <SDialog
    v-model:open="open"
    :title="t('lyricManager.databaseTitle')"
    title-tag="Beta"
    variant="settings"
    width="680px"
  >
    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap justify-end gap-2">
        <SButton variant="secondary" size="small" :loading="loading" @click="migrateDirectory">
          {{ t("lyricManager.migrateDirectory") }}
        </SButton>
        <SButton variant="secondary" size="small" :loading="loading" @click="importTtml">
          {{ t("lyricManager.importNeteaseTtml") }}
        </SButton>
        <SButton variant="secondary" size="small" :loading="loading" @click="load">
          {{ t("common.refreshCache") }}
        </SButton>
      </div>
      <div v-if="records.length === 0" class="py-8 text-center text-sm text-on-surface-variant/60">
        {{ t("lyricManager.emptyManaged") }}
      </div>
      <div
        v-for="record in records"
        :key="`${record.trackSource}:${record.trackId}`"
        class="flex items-center gap-3 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5"
      >
        <img
          v-if="record.track?.cover || record.track?.coverOriginal"
          :src="record.track?.cover || record.track?.coverOriginal"
          class="size-10 rounded object-cover shrink-0"
          decoding="async"
        />
        <div v-else class="size-10 rounded bg-surface flex items-center justify-center shrink-0">
          <IconLucideDisc3 class="size-4 text-on-surface-variant/45" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium truncate">
            {{ record.track?.title || record.filename || record.trackId }}
          </div>
          <div v-if="record.track" class="mt-0.5 text-xs text-on-surface-variant/65 truncate">
            {{ record.track.artists.map((artist) => artist.name).join(" / ") }}
          </div>
          <div v-else class="mt-0.5 text-xs text-error truncate">
            {{ t("lyricManager.unmatchedTrack") }}
          </div>
          <div class="mt-0.5 text-xs text-on-surface-variant/65 truncate">
            {{ record.trackSource }} · {{ record.trackId }} · {{ record.filename }} ·
            {{ record.format.toUpperCase() }} · {{ formatImportedAt(record.importedAt) }}
          </div>
          <div
            class="text-[11px] text-on-surface-variant/45 truncate font-mono"
            :title="record.filePath"
          >
            {{ record.filePath }}
          </div>
        </div>
        <SButton
          v-if="record.track"
          variant="secondary"
          size="small"
          @click="manageTrack(record.track)"
        >
          {{ t("lyricManager.manageTrack") }}
        </SButton>
        <SButton
          v-else
          variant="secondary"
          size="small"
          :loading="loading"
          @click="deleteUnmatchedLyric(record)"
        >
          {{ t("lyricManager.deleteLyric") }}
        </SButton>
      </div>
    </div>
  </SDialog>
</template>
