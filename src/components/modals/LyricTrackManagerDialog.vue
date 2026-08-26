<script setup lang="ts">
import { dialog } from "@/composables/useDialog";
import { useLyricTrackManagerDialog } from "@/composables/useLyricTrackManagerDialog";
import { toast } from "@/composables/useToast";
import { loadForTrack } from "@/services/lyric/loader";
import {
  getEffectiveTrackLyricPreference,
  setEffectiveTrackLyricPreference,
} from "@/services/lyric/preference";
import { useMediaStore } from "@/stores/media";
import * as player from "@/core/player";
import type { Track } from "@shared/types/player";
import type { LyricMatchCandidate, TrackLyricPreference } from "@shared/types/lyrics";
import { isPlatform } from "@shared/types/platform";

const { t } = useI18n();
const lyricManager = useLyricTrackManagerDialog();
const media = useMediaStore();
const managed = ref<Awaited<ReturnType<typeof window.api.lyrics.getManaged>>>(null);
const loading = ref(false);
const matchLoading = ref(false);
const candidates = ref<LyricMatchCandidate[]>([]);
const candidateActionId = ref<string | null>(null);
const preference = ref<TrackLyricPreference>({ source: "auto" });
let refreshToken = 0;
const syncOpen = ref(false);
const syncQuery = ref("");
const syncLoading = ref(false);
const syncResults = ref<Track[]>([]);
const syncSelected = ref<Track[]>([]);

const artistNames = computed(() =>
  lyricManager.track.value?.artists.map((artist) => artist.name).join(" / "),
);

const currentTrack = (): Track | null =>
  lyricManager.track.value ? (toRaw(lyricManager.track.value) as Track) : null;

const refresh = async (scanDirectory = true): Promise<void> => {
  const track = currentTrack();
  if (!track) {
    managed.value = null;
    candidates.value = [];
    return;
  }
  const token = ++refreshToken;
  matchLoading.value = true;
  try {
    if (scanDirectory) await window.api.lyrics.refreshManaged(track);
    const [nextManaged, nextCandidates, nextPreference] = await Promise.all([
      window.api.lyrics.getManaged(track),
      window.api.lyrics.getTrackCandidates(track),
      getEffectiveTrackLyricPreference(track),
    ]);
    if (token !== refreshToken || !lyricManager.open.value) return;
    managed.value = nextManaged;
    candidates.value = nextCandidates;
    preference.value = nextPreference;
  } catch {
    if (token === refreshToken) toast.error(t("lyricManager.refreshFailed"));
  } finally {
    if (token === refreshToken) matchLoading.value = false;
  }
};

/** 将候选来源转换为两个选择界面共享的逐曲首选项。 */
const candidatePreference = (candidate: LyricMatchCandidate): TrackLyricPreference | null => {
  if (candidate.local) return { source: "local", versionId: candidate.id };
  if (candidate.origin === "localTtml") return { source: "localTtml" };
  if (candidate.origin === "amll") {
    return candidate.platform === "netease" || candidate.platform === "qqmusic"
      ? { source: "amll", platform: candidate.platform }
      : null;
  }
  if (candidate.origin === "appleMusic") return { source: "appleMusic" };
  return isPlatform(candidate.origin) ? { source: "platform", platform: candidate.origin } : null;
};

/** 判断候选是否为用户显式锁定的来源。 */
const isCandidateExplicitlySelected = (candidate: LyricMatchCandidate): boolean => {
  const selected = preference.value;
  if (candidate.local) {
    return (
      selected.source === "local" &&
      candidate.active &&
      (!selected.versionId || selected.versionId === candidate.id)
    );
  }
  if (candidate.origin === "localTtml") return selected.source === "localTtml";
  if (candidate.origin === "amll") {
    return selected.source === "amll" && selected.platform === candidate.platform;
  }
  if (candidate.origin === "appleMusic") return selected.source === "appleMusic";
  return selected.source === "platform" && selected.platform === candidate.origin;
};

const smartSelection = computed(() => preference.value.source === "auto");
const isCurrentTrack = computed(() => {
  const track = lyricManager.track.value;
  return !!track && media.track?.source === track.source && media.track.id === track.id;
});

/** 仅从数据库或右键菜单打开时显示快捷播放入口。 */
const showPlayShortcut = computed(() => lyricManager.context.value !== "player");

/** 立即播放正在管理的歌曲。 */
const playManagedTrack = (): void => {
  const track = currentTrack();
  if (track) void player.playNow(track);
};

/** 将运行时实际歌词映射回匹配候选，仅用于展示智能选择结果。 */
const usedCandidate = computed((): LyricMatchCandidate | null => {
  const active = media.activeLyric;
  const content = media.lyricContent?.content;
  if (isCurrentTrack.value) {
    if (active && content) {
      const exact = candidates.value.find((candidate) => {
        if (candidate.content !== content || candidate.format !== active.format) return false;
        if (active.source === "managed") {
          return candidate.local && candidate.id === managed.value?.versionId;
        }
        if (active.source === "online") {
          return active.provider === "appleMusic"
            ? candidate.origin === "appleMusic"
            : candidate.platform === active.platform;
        }
        return candidate.origin === "localTtml";
      });
      if (exact) return exact;
    }
    return null;
  }
  if (smartSelection.value) {
    return candidates.value.find((candidate) => candidate.local && candidate.active) ?? null;
  }
  return candidates.value.find(isCandidateExplicitlySelected) ?? null;
});

const isCandidateSmartSelected = (candidate: LyricMatchCandidate): boolean =>
  smartSelection.value && usedCandidate.value?.id === candidate.id;

const isCandidateVisuallySelected = (candidate: LyricMatchCandidate): boolean =>
  isCandidateExplicitlySelected(candidate) || isCandidateSmartSelected(candidate);

const candidateSourceLabel = (candidate: LyricMatchCandidate): string => {
  const base = t(`lyricManager.matchSource.${candidate.origin}`);
  if (candidate.origin !== "amll" || !candidate.platform) return base;
  return `${base} · ${t(`lyricManager.matchSource.${candidate.platform}`)}`;
};

const currentLyricDescription = computed(() => {
  const candidate = usedCandidate.value;
  if (candidate) {
    return `${candidateSourceLabel(candidate)} · ${candidate.filename} · ${candidate.format.toUpperCase()}`;
  }
  if (!isCurrentTrack.value || !media.activeLyric) return t("lyricManager.currentLyricUnavailable");
  const active = media.activeLyric;
  const source =
    active.provider === "amll"
      ? t("lyricManager.activeSource.amll")
      : active.provider === "localTtml"
        ? t("lyricManager.matchSource.localTtml")
        : active.provider === "appleMusic"
          ? t("lyricManager.activeSource.appleMusic")
          : active.source === "online" && active.platform
            ? t(`lyricManager.matchSource.${active.platform}`)
            : t(`lyricManager.activeSource.${active.source}`);
  return `${source} · ${active.format.toUpperCase()}`;
});

/** 选择候选并立即刷新当前歌曲歌词。 */
const selectCandidate = async (candidate: LyricMatchCandidate): Promise<void> => {
  const track = currentTrack();
  const nextPreference = candidatePreference(candidate);
  if (!track || !nextPreference || isCandidateExplicitlySelected(candidate)) return;
  candidateActionId.value = candidate.id;
  try {
    const selected = await window.api.lyrics.selectTrackCandidate(
      track,
      toRaw(candidate) as LyricMatchCandidate,
    );
    if (!selected) {
      toast.error(t("lyricManager.selectFailed"));
      return;
    }
    await setEffectiveTrackLyricPreference(track, nextPreference);
    await refreshCurrentLyric();
  } catch {
    toast.error(t("lyricManager.selectFailed"));
  } finally {
    candidateActionId.value = null;
  }
};

/** 切换为该歌曲独立的智能选择模式。 */
const selectSmart = async (): Promise<void> => {
  const track = currentTrack();
  if (!track || smartSelection.value) return;
  candidateActionId.value = "smart";
  try {
    await setEffectiveTrackLyricPreference(track, { source: "auto" });
    await refreshCurrentLyric();
  } catch {
    toast.error(t("lyricManager.selectFailed"));
  } finally {
    candidateActionId.value = null;
  }
};

/** 右键删除未被播放器实际使用的本地歌词版本。 */
const deleteCandidate = async (candidate: LyricMatchCandidate): Promise<void> => {
  const track = currentTrack();
  if (!track || !candidate.local) return;
  if (usedCandidate.value?.id === candidate.id) {
    toast.error(t("lyricManager.inUseDeleteHint"));
    return;
  }
  const confirmed = await dialog.confirm({
    title: t("lyricManager.deleteVersionTitle"),
    content: t("lyricManager.deleteVersionDescription", { filename: candidate.filename }),
    type: "error",
    layer: "topmost",
  });
  if (!confirmed) return;
  candidateActionId.value = candidate.id;
  try {
    const deleted = await window.api.lyrics.deleteManagedVersion(track, candidate.id);
    if (!deleted) {
      toast.error(t("lyricManager.deleteVersionFailed"));
      return;
    }
    await refresh();
  } catch {
    toast.error(t("lyricManager.deleteVersionFailed"));
  } finally {
    candidateActionId.value = null;
  }
};

const trackKey = (track: Track): string => `${track.source}:${track.id}`;

const toggleSyncTarget = (track: Track, checked: boolean): void => {
  const key = trackKey(track);
  syncSelected.value = checked
    ? [...syncSelected.value.filter((item) => trackKey(item) !== key), track]
    : syncSelected.value.filter((item) => trackKey(item) !== key);
};

const searchSyncTargets = async (): Promise<void> => {
  const source = currentTrack();
  if (!source || !syncQuery.value.trim()) return;
  syncLoading.value = true;
  try {
    const [localTracks, onlineTracks] = await Promise.all([
      window.api.lyrics.searchTracks(syncQuery.value),
      window.api.lyrics.searchOnlineTracks(syncQuery.value),
    ]);
    syncResults.value = [...localTracks, ...onlineTracks].filter(
      (track) => trackKey(track) !== trackKey(source),
    );
  } finally {
    syncLoading.value = false;
  }
};

const applyToTargets = async (): Promise<void> => {
  const source = currentTrack();
  if (!source || syncSelected.value.length === 0) return;
  syncLoading.value = true;
  try {
    // Electron IPC 无法克隆 Vue 响应式代理；同步目标来自响应式搜索列表，传输前需还原。
    const targets = syncSelected.value.map((track) => toRaw(track) as Track);
    const applied = await window.api.lyrics.copyManaged(source, targets);
    if (applied === 0) {
      toast.error(t("lyricManager.syncFailed"));
      return;
    }
    syncOpen.value = false;
    syncSelected.value = [];
  } catch (error) {
    console.error("[lyricManager] 同步手动歌词 IPC 调用失败:", error);
    toast.error(t("lyricManager.syncFailed"));
  } finally {
    syncLoading.value = false;
  }
};

/** 重新扫描目录；若管理当前播放曲目，则同时重新解析歌词。 */
const refreshCurrentLyric = async (): Promise<void> => {
  const track = currentTrack();
  if (!track) return;
  await window.api.lyrics.refreshManaged(track);
  if (media.track?.source === track.source && media.track.id === track.id) {
    await loadForTrack(media.detail);
  }
  await refresh(false);
};

/** 在文件管理器中打开当前歌曲的手动歌词目录。 */
const openTrackLyricDirectory = async (): Promise<void> => {
  const track = currentTrack();
  if (!track) return;
  await window.api.lyrics.openManagedTrackDir(track);
};

const importLyric = async (): Promise<void> => {
  const track = currentTrack();
  if (!track) return;
  const lyric = await window.api.lyrics.pickManagedFile();
  if (!lyric) return;
  loading.value = true;
  try {
    let result = await window.api.lyrics.setManaged(track, lyric);
    if (result.status === "conflict") {
      const overwrite = await dialog.confirm({
        title: t("lyricManager.overwriteTitle"),
        content: t("lyricManager.overwriteDescription", { filename: result.filename }),
        type: "warning",
        layer: "topmost",
      });
      if (!overwrite) return;
      await window.api.lyrics.setManaged(track, lyric, true);
    }
    await refreshCurrentLyric();
  } catch {
    toast.error(t("lyricManager.importFailed"));
  } finally {
    loading.value = false;
  }
};

watch(
  () => ({
    open: lyricManager.open.value,
    trackKey: lyricManager.track.value
      ? `${lyricManager.track.value.source}:${lyricManager.track.value.id}`
      : "",
  }),
  ({ open }) => {
    if (open) {
      managed.value = null;
      candidates.value = [];
      preference.value = { source: "auto" };
      syncOpen.value = false;
      syncQuery.value = "";
      syncResults.value = [];
      syncSelected.value = [];
      void refresh();
      return;
    }
    refreshToken++;
    matchLoading.value = false;
    managed.value = null;
    candidates.value = [];
    preference.value = { source: "auto" };
    candidateActionId.value = null;
    syncOpen.value = false;
    syncQuery.value = "";
    syncLoading.value = false;
    syncResults.value = [];
    syncSelected.value = [];
  },
);
</script>

<template>
  <SDialog
    :open="lyricManager.open.value"
    :title="t('lyricManager.trackTitle')"
    title-tag="Beta"
    variant="settings"
    width="620px"
    layer="top"
    @update:open="lyricManager.setOpen"
  >
    <div v-if="lyricManager.track.value" class="flex flex-col gap-4">
      <div
        class="flex gap-3 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 p-3"
      >
        <img
          v-if="lyricManager.track.value.cover"
          :src="lyricManager.track.value.cover"
          class="size-18 rounded-lg object-cover shrink-0"
          decoding="async"
        />
        <div v-else class="size-18 rounded-lg bg-surface flex items-center justify-center shrink-0">
          <IconLucideDisc3 class="size-7 text-on-surface-variant/45" />
        </div>
        <div class="min-w-0 flex-1 py-0.5">
          <div class="text-base font-medium truncate">{{ lyricManager.track.value.title }}</div>
          <div class="mt-1 text-sm text-on-surface-variant/70 truncate">
            {{ artistNames || t("lyricManager.unknownArtist") }}
          </div>
          <div class="mt-1 text-xs text-on-surface-variant/55 truncate">
            {{ t("lyricManager.trackId") }}：{{ lyricManager.track.value.source }} ·
            {{ lyricManager.track.value.id }}
          </div>
        </div>
        <SButton
          v-if="showPlayShortcut"
          variant="secondary"
          circle
          :title="t('songList.context.play')"
          @click="playManagedTrack"
        >
          <template #icon><IconLucidePlay /></template>
        </SButton>
      </div>

      <div
        class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3"
      >
        <div class="text-sm font-medium">{{ t("lyricManager.currentLyric") }}</div>
        <div class="mt-1 text-sm text-on-surface-variant/75 break-all">
          {{ currentLyricDescription }}
        </div>
        <div v-if="smartSelection" class="mt-1 text-xs text-primary">
          {{ t("lyricManager.smartSelectionHint") }}
        </div>
      </div>

      <div class="flex flex-wrap justify-end gap-2">
        <SButton variant="secondary" @click="openTrackLyricDirectory">
          {{ t("lyricManager.openDirectory") }}
        </SButton>
        <SButton variant="secondary" :loading="loading" @click="refreshCurrentLyric">
          {{ t("lyricManager.refreshLyric") }}
        </SButton>
        <SButton v-if="managed" variant="secondary" @click="syncOpen = true">
          {{ t("lyricManager.syncToTracks") }}
        </SButton>
        <SButton variant="secondary" :loading="loading" @click="importLyric">
          {{ t("lyricManager.import") }}
        </SButton>
        <SButton variant="secondary" @click="lyricManager.hide">
          {{ t("common.close") }}
        </SButton>
      </div>

      <div class="flex flex-col gap-2.5">
        <div class="flex items-center gap-3 px-1">
          <div class="min-w-0 flex-1">
            <div class="text-base font-medium">{{ t("lyricManager.matchResults") }}</div>
          </div>
          <SButton variant="ghost" circle :loading="matchLoading" @click="refresh">
            <template #icon><IconLucideRefreshCw /></template>
          </SButton>
        </div>
        <div
          class="flex items-center gap-3 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5"
          :class="smartSelection ? 'border-primary/50! bg-primary/5!' : ''"
        >
          <IconLucideSparkles class="size-4 shrink-0 text-primary" />
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium">{{ t("lyricManager.smartSelection") }}</div>
            <div class="mt-0.5 text-xs text-on-surface-variant/60">
              {{ t("lyricManager.smartSelectionDescription") }}
            </div>
          </div>
          <SButton
            type="primary"
            variant="secondary"
            size="small"
            :disabled="smartSelection"
            :loading="candidateActionId === 'smart'"
            @click="selectSmart"
          >
            {{ t(smartSelection ? "lyricManager.selected" : "lyricManager.select") }}
          </SButton>
        </div>
        <div v-if="candidates.length" class="max-h-72 overflow-y-auto flex flex-col gap-2.5">
          <div
            v-for="candidate in candidates"
            :key="candidate.id"
            class="flex items-center gap-3 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5"
            :class="
              isCandidateVisuallySelected(candidate) ? 'border-primary/50! bg-primary/5!' : ''
            "
            :title="
              candidate.local
                ? usedCandidate?.id === candidate.id
                  ? t('lyricManager.inUseDeleteHint')
                  : t('lyricManager.deleteVersionHint')
                : undefined
            "
            @contextmenu.prevent="deleteCandidate(candidate)"
          >
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium truncate">
                  {{ candidateSourceLabel(candidate) }}
                </span>
                <STag v-if="candidate.local" size="tiny">
                  {{ t("lyricManager.localVersion") }}
                </STag>
                <STag v-if="isCandidateSmartSelected(candidate)" size="tiny" type="primary">
                  {{ t("lyricManager.smartSelected") }}
                </STag>
              </div>
              <div class="mt-0.5 text-xs text-on-surface-variant/60 truncate">
                {{
                  candidate.status && candidate.status !== 'available'
                    ? t(`lyricManager.appleMusicStatus.${candidate.status}`)
                    : `${candidate.format.toUpperCase()} · ${candidate.filename}`
                }}
              </div>
            </div>
            <SButton
              type="primary"
              variant="secondary"
              size="small"
              :disabled="isCandidateExplicitlySelected(candidate) || !!(candidate.status && candidate.status !== 'available')"
              :loading="candidateActionId === candidate.id"
              @click="selectCandidate(candidate)"
            >
              {{
                t(
                  isCandidateExplicitlySelected(candidate)
                    ? "lyricManager.selected"
                    : "lyricManager.select",
                )
              }}
            </SButton>
          </div>
        </div>
        <div v-else class="py-8 text-center text-sm text-on-surface-variant/60">
          {{ matchLoading ? t("lyricManager.matching") : t("lyricManager.noMatchResults") }}
        </div>
      </div>
    </div>
  </SDialog>

  <SDialog
    v-model:open="syncOpen"
    :title="t('lyricManager.syncTitle')"
    variant="settings"
    width="560px"
    layer="top"
  >
    <div class="flex flex-col gap-3">
      <div class="flex gap-2">
        <SInput
          v-model="syncQuery"
          class="flex-1"
          :placeholder="t('lyricManager.searchTrackPlaceholder')"
          @keydown.enter="searchSyncTargets"
        />
        <SButton variant="secondary" :loading="syncLoading" @click="searchSyncTargets">
          {{ t("common.search") }}
        </SButton>
      </div>
      <div v-if="syncResults.length" class="max-h-72 overflow-y-auto flex flex-col gap-1">
        <SCheckbox
          v-for="track in syncResults"
          :key="trackKey(track)"
          :checked="syncSelected.some((item) => trackKey(item) === trackKey(track))"
          class="w-full! rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3 hover:bg-on-surface/5"
          @update:checked="toggleSyncTarget(track, $event)"
        >
          <div class="flex items-center gap-2 min-w-0">
            <img
              v-if="track.cover || track.coverOriginal"
              :src="track.cover || track.coverOriginal"
              class="size-9 rounded object-cover shrink-0"
              decoding="async"
            />
            <div v-else class="size-9 rounded bg-surface flex items-center justify-center shrink-0">
              <IconLucideDisc3 class="size-4 text-on-surface-variant/45" />
            </div>
            <div class="min-w-0">
              <div class="text-sm truncate">{{ track.title }}</div>
              <div class="text-xs text-on-surface-variant/60 truncate">
                {{ track.artists.map((artist) => artist.name).join(" / ") }} · {{ track.id }}
              </div>
            </div>
          </div>
        </SCheckbox>
      </div>
      <div v-else class="py-6 text-center text-sm text-on-surface-variant/60">
        {{ t("lyricManager.searchTrackHint") }}
      </div>
    </div>
    <template #footer="{ close }">
      <SButton variant="secondary" @click="close">{{ t("common.cancel") }}</SButton>
      <SButton
        type="primary"
        :disabled="syncSelected.length === 0"
        :loading="syncLoading"
        @click="applyToTargets"
      >
        {{ t("lyricManager.applyToTracks", { count: syncSelected.length }) }}
      </SButton>
    </template>
  </SDialog>
</template>
