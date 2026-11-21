<script setup lang="ts">
import type { MotionCoverCacheRecord } from "@shared/types/player";
import { dialog } from "@/composables/useDialog";
import { toast } from "@/composables/useToast";
import { useCopyText } from "@/composables/useCopyText";
import { useMotionCoverManagerDialog } from "@/composables/useMotionCoverManagerDialog";

const { t } = useI18n();
const { copy } = useCopyText();
const manager = useMotionCoverManagerDialog();
const { open, keyword } = manager;

const loading = ref(false);
const search = ref("");
const records = shallowRef<MotionCoverCacheRecord[]>([]);

/** 命中缓存有效期为一天，未命中十分钟 */
const HIT_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 10 * 60 * 1000;

const load = async (): Promise<void> => {
  loading.value = true;
  try {
    records.value = await window.api.motionCover.listCache();
  } finally {
    loading.value = false;
  }
};

/** 按缓存键前缀归类，方便区分曲目与专辑记录 */
const typeKey = (fingerprint: string): string => {
  const prefix = fingerprint.split("|", 1)[0];
  if (prefix === "track") return "track";
  if (prefix === "album") return "album";
  if (prefix === "atrack") return "appleTrack";
  if (prefix === "collection") return "collection";
  return "other";
};

/** 记录是否已超过对应 TTL */
const isExpired = (record: MotionCoverCacheRecord): boolean =>
  Date.now() - record.matchedAt > (record.videoUrl ? HIT_TTL_MS : MISS_TTL_MS);

const formatMatchedAt = (value: number): string => new Date(value).toLocaleString();

const filteredRecords = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return records.value;
  return records.value.filter((record) => {
    const haystack = [
      record.fingerprint,
      record.videoUrl ?? "",
      record.track?.title ?? "",
      record.track?.artists.map((artist) => artist.name).join(" ") ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(term);
  });
});

/** 删除单条匹配记录，下次播放重新匹配 */
const removeRecord = async (record: MotionCoverCacheRecord): Promise<void> => {
  const confirmed = await dialog.confirm({
    title: t("motionCoverManager.deleteTitle"),
    content: t("motionCoverManager.deleteContent"),
    type: "warning",
  });
  if (!confirmed) return;
  loading.value = true;
  try {
    await window.api.motionCover.deleteCache(record.fingerprint);
    await load();
  } catch {
    toast.error(t("motionCoverManager.deleteFailed"));
  } finally {
    loading.value = false;
  }
};

/** 清空全部匹配缓存 */
const clearAll = async (): Promise<void> => {
  if (records.value.length === 0) return;
  const confirmed = await dialog.confirm({
    title: t("motionCoverManager.clearTitle"),
    content: t("motionCoverManager.clearContent"),
    type: "warning",
  });
  if (!confirmed) return;
  loading.value = true;
  try {
    await window.api.motionCover.clearCache();
    await load();
    toast.success(t("motionCoverManager.clearDone"));
  } catch {
    toast.error(t("motionCoverManager.clearFailed"));
  } finally {
    loading.value = false;
  }
};

/** 复制动态封面地址 */
const copyUrl = async (url: string): Promise<void> => {
  await copy(url);
};

// 打开时带上调用方传入的搜索词（如当前曲名）
watch(open, (value) => {
  if (!value) return;
  search.value = keyword.value;
  void load();
});
</script>

<template>
  <SDialog
    v-model:open="open"
    :title="t('motionCoverManager.title')"
    variant="settings"
    width="720px"
  >
    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <SInput
          v-model="search"
          class="max-w-64"
          :placeholder="t('motionCoverManager.searchPlaceholder')"
          clearable
        />
        <div class="flex items-center gap-2">
          <SButton variant="secondary" size="small" :loading="loading" @click="load">
            {{ t("common.refreshCache") }}
          </SButton>
          <SButton variant="secondary" size="small" :disabled="!records.length" @click="clearAll">
            {{ t("motionCoverManager.clearAll") }}
          </SButton>
        </div>
      </div>

      <div
        v-if="filteredRecords.length === 0"
        class="py-10 text-center text-sm text-on-surface-variant/60"
      >
        {{ t("motionCoverManager.empty") }}
      </div>

      <div
        v-for="record in filteredRecords"
        :key="record.fingerprint"
        class="flex items-center gap-3 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3"
      >
        <img
          v-if="record.track?.cover || record.track?.coverOriginal"
          :src="record.track.cover || record.track.coverOriginal"
          class="size-10 shrink-0 rounded object-cover"
          decoding="async"
        />
        <div v-else class="flex size-10 shrink-0 items-center justify-center rounded bg-surface">
          <IconLucideClapperboard class="size-4 text-on-surface-variant/45" />
        </div>

        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium">
            {{ record.track?.title || record.fingerprint }}
          </div>
          <div v-if="record.track" class="mt-0.5 truncate text-xs text-on-surface-variant/65">
            {{ record.track.artists.map((artist) => artist.name).join(" / ") }}
          </div>
          <div
            class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-on-surface-variant/55"
          >
            <span>{{ t(`motionCoverManager.types.${typeKey(record.fingerprint)}`) }}</span>
            <span>·</span>
            <span>
              {{ t("motionCoverManager.matchedAt", { time: formatMatchedAt(record.matchedAt) }) }}
            </span>
            <span>·</span>
            <span :class="isExpired(record) ? 'text-error' : 'text-primary'">
              {{
                isExpired(record) ? t("motionCoverManager.expired") : t("motionCoverManager.active")
              }}
            </span>
            <span v-if="!record.videoUrl">· {{ t("motionCoverManager.noCover") }}</span>
          </div>
          <div
            v-if="record.videoUrl"
            class="mt-0.5 truncate font-mono text-[11px] text-on-surface-variant/40"
            :title="record.videoUrl"
          >
            {{ record.videoUrl }}
          </div>
        </div>

        <SButton
          v-if="record.videoUrl"
          variant="ghost"
          circle
          size="small"
          :title="t('motionCoverManager.copyUrl')"
          :aria-label="t('motionCoverManager.copyUrl')"
          @click="copyUrl(record.videoUrl)"
        >
          <template #icon><IconLucideCopy class="size-3.5" /></template>
        </SButton>
        <SButton variant="secondary" size="small" :loading="loading" @click="removeRecord(record)">
          {{ t("motionCoverManager.delete") }}
        </SButton>
      </div>
    </div>
  </SDialog>
</template>
