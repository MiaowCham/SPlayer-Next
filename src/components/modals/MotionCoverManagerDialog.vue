<script setup lang="ts">
import type {
  MotionCoverCacheRecord,
  MotionCoverManualRecord,
  MotionCoverSearchCandidate,
  MotionCoverSearchSource,
  Track,
} from "@shared/types/player";
import { dialog } from "@/composables/useDialog";
import { toast } from "@/composables/useToast";
import { useCopyText } from "@/composables/useCopyText";
import { useMotionCoverManagerDialog } from "@/composables/useMotionCoverManagerDialog";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";

const { t } = useI18n();
const { copy } = useCopyText();
const media = useMediaStore();
const settings = useSettingsStore();
const manager = useMotionCoverManagerDialog();
const { open, keyword } = manager;

/** 命中缓存有效期为一天，未命中十分钟 */
const HIT_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 10 * 60 * 1000;

const tab = ref<"cache" | "search">("cache");
const loading = ref(false);
const search = ref("");
const records = shallowRef<MotionCoverCacheRecord[]>([]);
const manual = shallowRef<MotionCoverManualRecord | null>(null);

const currentTrack = computed<Track | null>(() => manager.track.value ?? media.track ?? null);

const source = ref<MotionCoverSearchSource>("ncm");
const storefront = ref(settings.player.appleMusicStorefront || "us");
const searchKeyword = ref("");
const searching = ref(false);
const results = shallowRef<MotionCoverSearchCandidate[]>([]);
const previewUrl = ref("");
const previewingId = ref("");
const applyingId = ref("");

const storefrontOptions = [
  { value: "us", label: "美国 (us)" },
  { value: "hk", label: "香港 (hk)" },
  { value: "tw", label: "台湾 (tw)" },
  { value: "jp", label: "日本 (jp)" },
  { value: "sg", label: "新加坡 (sg)" },
  { value: "kr", label: "韩国 (kr)" },
  { value: "ca", label: "加拿大 (ca)" },
];

const loadCache = async (): Promise<void> => {
  loading.value = true;
  try {
    records.value = await window.api.motionCover.listCache();
  } finally {
    loading.value = false;
  }
};

const loadManual = async (): Promise<void> => {
  const track = currentTrack.value;
  if (!track) {
    manual.value = null;
    return;
  }
  manual.value = await window.api.motionCover.getManual(track);
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
    await loadCache();
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
    await loadCache();
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

const runSearch = async (): Promise<void> => {
  const term = searchKeyword.value.trim();
  if (!term) return;
  searching.value = true;
  previewUrl.value = "";
  try {
    results.value = await window.api.motionCover.search(source.value, term, storefront.value);
  } catch {
    toast.error(t("motionCoverManager.searchFailed"));
  } finally {
    searching.value = false;
  }
};

const previewCandidate = async (candidate: MotionCoverSearchCandidate): Promise<void> => {
  previewingId.value = candidate.id;
  try {
    const url = await window.api.motionCover.preview(candidate);
    if (!url) {
      toast.error(t("motionCoverManager.previewFailed"));
      return;
    }
    if (candidate.source === "am") {
      toast.info(t("motionCoverManager.previewAmHint"));
      await copy(url);
      return;
    }
    previewUrl.value = url;
  } catch {
    toast.error(t("motionCoverManager.previewFailed"));
  } finally {
    previewingId.value = "";
  }
};

const applyCandidate = async (candidate: MotionCoverSearchCandidate): Promise<void> => {
  const track = currentTrack.value;
  if (!track) {
    toast.error(t("motionCoverManager.noTrack"));
    return;
  }
  applyingId.value = candidate.id;
  try {
    manual.value = await window.api.motionCover.applyManual(toRaw(track), candidate);
    toast.success(t("motionCoverManager.applied"));
  } catch {
    toast.error(t("motionCoverManager.applyFailed"));
  } finally {
    applyingId.value = "";
  }
};

/** 恢复自动匹配 */
const restoreAuto = async (): Promise<void> => {
  const track = currentTrack.value;
  if (!track) return;
  try {
    await window.api.motionCover.clearManual(track);
    manual.value = null;
    toast.success(t("motionCoverManager.clearManualDone"));
  } catch {
    toast.error(t("motionCoverManager.applyFailed"));
  }
};

// 打开时加载缓存与当前曲目状态，搜索词优先用调用方传入的曲名
watch(open, (value) => {
  if (!value) return;
  tab.value = "cache";
  search.value = keyword.value;
  searchKeyword.value = keyword.value || currentTrack.value?.title || "";
  results.value = [];
  previewUrl.value = "";
  void loadCache();
  void loadManual();
});
</script>

<template>
  <SDialog
    v-model:open="open"
    :title="t('motionCoverManager.title')"
    variant="settings"
    width="760px"
  >
    <div class="flex flex-col gap-3">
      <!-- 当前曲目与手动状态 -->
      <div
        v-if="currentTrack"
        class="flex items-center gap-3 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3"
      >
        <img
          v-if="currentTrack.cover || currentTrack.coverOriginal"
          :src="currentTrack.cover || currentTrack.coverOriginal"
          class="size-10 shrink-0 rounded object-cover"
          decoding="async"
        />
        <div v-else class="flex size-10 shrink-0 items-center justify-center rounded bg-surface">
          <IconLucideClapperboard class="size-4 text-on-surface-variant/45" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium">{{ currentTrack.title }}</div>
          <div class="mt-0.5 truncate text-xs text-on-surface-variant/65">
            {{ currentTrack.artists.map((artist) => artist.name).join(" / ") }}
          </div>
        </div>
        <div v-if="manual" class="flex shrink-0 items-center gap-2">
          <span class="text-xs text-primary">{{ t("motionCoverManager.manualActive") }}</span>
          <SButton variant="secondary" size="small" @click="restoreAuto">
            {{ t("motionCoverManager.restoreAuto") }}
          </SButton>
        </div>
      </div>

      <!-- 标签切换 -->
      <div class="flex items-center gap-2">
        <SButton
          :variant="tab === 'cache' ? 'filled' : 'secondary'"
          size="small"
          @click="tab = 'cache'"
        >
          {{ t("motionCoverManager.tabs.cache") }}
        </SButton>
        <SButton
          :variant="tab === 'search' ? 'filled' : 'secondary'"
          size="small"
          :disabled="!currentTrack"
          @click="tab = 'search'"
        >
          {{ t("motionCoverManager.tabs.search") }}
        </SButton>
      </div>

      <!-- 缓存管理 -->
      <template v-if="tab === 'cache'">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <SInput
            v-model="search"
            class="max-w-64"
            :placeholder="t('motionCoverManager.searchPlaceholder')"
            clearable
          />
          <div class="flex items-center gap-2">
            <SButton variant="secondary" size="small" :loading="loading" @click="loadCache">
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
                  isExpired(record)
                    ? t("motionCoverManager.expired")
                    : t("motionCoverManager.active")
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
          <SButton
            variant="secondary"
            size="small"
            :loading="loading"
            @click="removeRecord(record)"
          >
            {{ t("motionCoverManager.delete") }}
          </SButton>
        </div>
      </template>

      <!-- 在线搜索 -->
      <template v-else>
        <div class="flex flex-wrap items-center gap-2">
          <SButton
            :variant="source === 'ncm' ? 'filled' : 'secondary'"
            size="small"
            @click="
              source = 'ncm';
              results = [];
            "
          >
            {{ t("motionCoverManager.sources.ncm") }}
          </SButton>
          <SButton
            :variant="source === 'am' ? 'filled' : 'secondary'"
            size="small"
            @click="
              source = 'am';
              results = [];
            "
          >
            {{ t("motionCoverManager.sources.am") }}
          </SButton>
          <div v-if="source === 'am'" class="w-36">
            <SSelect v-model="storefront" :options="storefrontOptions" />
          </div>
          <SInput
            v-model="searchKeyword"
            class="min-w-48 flex-1"
            :placeholder="t('motionCoverManager.searchPlaceholder')"
            clearable
            @keydown.enter="runSearch"
          />
          <SButton variant="secondary" size="small" :loading="searching" @click="runSearch">
            {{ t("motionCoverManager.search") }}
          </SButton>
        </div>

        <div v-if="previewUrl" class="flex items-center gap-3">
          <video
            :src="previewUrl"
            class="h-24 w-40 rounded-lg bg-black object-cover"
            muted
            loop
            autoplay
            playsinline
          />
          <div class="text-xs text-on-surface-variant/60">
            {{ t("motionCoverManager.preview") }}
          </div>
        </div>

        <div
          v-if="!searching && results.length === 0"
          class="py-8 text-center text-sm text-on-surface-variant/60"
        >
          {{ t("motionCoverManager.searchEmpty") }}
        </div>

        <div
          v-for="candidate in results"
          :key="`${candidate.source}:${candidate.id}`"
          class="flex items-center gap-3 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3"
        >
          <img
            v-if="candidate.cover"
            :src="candidate.cover"
            class="size-10 shrink-0 rounded object-cover"
            decoding="async"
          />
          <div v-else class="size-10 shrink-0 rounded bg-surface" />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium">{{ candidate.title }}</div>
            <div class="mt-0.5 truncate text-xs text-on-surface-variant/65">
              {{ candidate.artist }}
            </div>
            <div class="mt-0.5 truncate text-xs text-on-surface-variant/50">
              {{ candidate.album }}
            </div>
          </div>
          <SButton
            variant="ghost"
            size="small"
            :loading="previewingId === candidate.id"
            @click="previewCandidate(candidate)"
          >
            {{ t("motionCoverManager.preview") }}
          </SButton>
          <SButton
            variant="secondary"
            size="small"
            :loading="applyingId === candidate.id"
            @click="applyCandidate(candidate)"
          >
            {{ t("motionCoverManager.apply") }}
          </SButton>
        </div>
      </template>
    </div>
  </SDialog>
</template>
