<script setup lang="ts">
import { dialog } from "@/composables/useDialog";
import { useLyricTrackManagerDialog } from "@/composables/useLyricTrackManagerDialog";
import { useLyricOptimizeDialog } from "@/composables/useLyricOptimizeDialog";
import { toast } from "@/composables/useToast";
import { loadForTrack } from "@/services/lyric/loader";
import {
  getEffectiveTrackLyricPreference,
  setEffectiveTrackLyricPreference,
} from "@/services/lyric/preference";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { DEFAULT_LYRIC_SOURCE_ORDER, type LyricSourceOrderItem } from "@/types/settings";
import * as player from "@/core/player";
import { getLyricSourceUrl } from "@/utils/format/shareUrl";
import { openExternal } from "@/utils/url";
import type { Track } from "@shared/types/player";
import type { LyricMatchCandidate, TrackLyricPreference } from "@shared/types/lyrics";
import { isPlatform } from "@shared/types/platform";
import { normalizeTtml } from "@shared/utils/ttml";
import LyricOptimizeDialog from "./LyricOptimizeDialog.vue";

const { t } = useI18n();
const lyricManager = useLyricTrackManagerDialog();
const lyricOptimize = useLyricOptimizeDialog();
const media = useMediaStore();
const settings = useSettingsStore();
const managed = ref<Awaited<ReturnType<typeof window.api.lyrics.getManaged>>>(null);
const loading = ref(false);
const matchLoading = ref(false);
const candidates = shallowRef<LyricMatchCandidate[]>([]);
const focusedCandidateId = ref<string | null>(null);
const onlineLoading = ref(false);
const isDatabase = computed(() => lyricManager.context.value === "database");
const candidateActionId = ref<string | null>(null);
const preference = ref<TrackLyricPreference>({ source: "auto" });
let refreshToken = 0;
const syncOpen = ref(false);
const syncQuery = ref("");
const syncLoading = ref(false);
const syncResults = ref<Track[]>([]);
const syncSelected = ref<Track[]>([]);
const customSearchOpen = ref(false);
const customSearchTitle = ref("");
const customSearchArtist = ref("");

const artistNames = computed(() =>
  lyricManager.track.value?.artists.map((artist) => artist.name).join(" / "),
);

const currentTrack = (): Track | null =>
  lyricManager.track.value ? (toRaw(lyricManager.track.value) as Track) : null;

/**
 * 刷新当前曲目的歌词版本，切换曲目后忽略旧请求
 * @param scanDirectory - 是否先扫描手动歌词目录
 */
const refresh = async (scanDirectory = true): Promise<void> => {
  const token = ++refreshToken;
  const track = currentTrack();
  if (!track) {
    managed.value = null;
    candidates.value = [];
    matchLoading.value = false;
    onlineLoading.value = false;
    return;
  }
  matchLoading.value = true;
  try {
    if (scanDirectory) await window.api.lyrics.refreshManaged(track);
    // 先显示本地/managed 候选（快），避免等在线搜索完成后才出列表
    const [nextManaged, localCandidates, nextPreference] = await Promise.all([
      window.api.lyrics.getManaged(track),
      window.api.lyrics.getTrackCandidatesLocal(track),
      getEffectiveTrackLyricPreference(track),
    ]);
    if (token !== refreshToken || !lyricManager.open.value) return;
    managed.value = nextManaged;
    preference.value = nextPreference;
    candidates.value = localCandidates;
    matchLoading.value = false;
    onlineLoading.value = true;
    // 异步补全在线候选（平台/AM），完成后再叠加到列表
    const fullCandidates = await window.api.lyrics.getTrackCandidates(track);
    if (token !== refreshToken || !lyricManager.open.value) return;
    candidates.value = fullCandidates;
  } catch {
    if (token === refreshToken) toast.error(t("lyricManager.refreshFailed"));
  } finally {
    if (token === refreshToken) {
      matchLoading.value = false;
      onlineLoading.value = false;
    }
  }
};

/** 将候选来源转换为两个选择界面共享的逐曲首选项。 */
const candidatePreference = (candidate: LyricMatchCandidate): TrackLyricPreference | null => {
  const search = preference.value.search;
  if (candidate.local) return { source: "local", versionId: candidate.id, search };
  if (candidate.origin === "localTtml") return { source: "localTtml", search };
  if (candidate.origin === "amll") {
    return candidate.platform === "netease" || candidate.platform === "qqmusic"
      ? { source: "amll", platform: candidate.platform, search }
      : null;
  }
  if (candidate.origin === "appleMusic") return { source: "appleMusic", search };
  return isPlatform(candidate.origin)
    ? { source: "platform", platform: candidate.origin, search }
    : null;
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
/** Apple Music 只展示已取得并含正文的 TTML，避免失败状态成为可选来源。 */
const visibleCandidates = computed(() => {
  const filtered = candidates.value.filter(
    (candidate) =>
      candidate.origin !== "appleMusic" ||
      (candidate.status === "available" && !!candidate.content.trim()),
  );
  // 按歌词来源排序顺序（lyricSourceOrder）展示候选，便于用户按来源优先级挑选。
  const sourceOrder = settings.lyric.lyricSourceOrder ?? DEFAULT_LYRIC_SOURCE_ORDER;
  const indexOf = (candidate: LyricMatchCandidate): number => {
    // 候选 origin 映射到来源排序项；本地/manual origin 未在排序项时按 localTtml 处理
    const item: LyricSourceOrderItem =
      candidate.origin === "manual" ? "localTtml" : candidate.origin;
    const idx = sourceOrder.indexOf(item);
    return idx === -1 ? sourceOrder.length : idx;
  };
  return [...filtered].sort((a, b) => indexOf(a) - indexOf(b));
});
const focusedCandidate = computed(
  () =>
    visibleCandidates.value.find((candidate) => candidate.id === focusedCandidateId.value) ??
    usedCandidate.value ??
    visibleCandidates.value[0] ??
    null,
);
const candidateGroups = computed(() => [
  {
    name: t("lyricManager.localVersion"),
    items: visibleCandidates.value.filter((candidate) => candidate.local),
  },
  {
    name: t("lyricManager.onlineAndCached"),
    items: visibleCandidates.value.filter((candidate) => !candidate.local),
  },
]);
const missingSources = computed(() =>
  (settings.lyric.lyricSourceOrder ?? DEFAULT_LYRIC_SOURCE_ORDER).filter(
    (origin) => !visibleCandidates.value.some((candidate) => candidate.origin === origin),
  ),
);

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
      const exact = visibleCandidates.value.find((candidate) => {
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
    return visibleCandidates.value.find((candidate) => candidate.local && candidate.active) ?? null;
  }
  return visibleCandidates.value.find(isCandidateExplicitlySelected) ?? null;
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

/** 候选来源平台的原链接（用于"来源"按钮跳转）。 */
const candidateSourceUrl = (candidate: LyricMatchCandidate): string | null =>
  getLyricSourceUrl(candidate.origin, candidate.extra, currentTrack());

/** 打开候选来源平台的原始页面。 */
const openCandidateSourceUrl = (candidate: LyricMatchCandidate): void => {
  const url = candidateSourceUrl(candidate);
  if (url) void openExternal(url);
};

/** 打开歌词优化（编辑）弹窗。 */
const openOptimize = (candidate: LyricMatchCandidate): void => {
  const track = currentTrack();
  if (!track) return;
  lyricOptimize.show(track, candidate);
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
    await setEffectiveTrackLyricPreference(track, {
      source: "auto",
      search: preference.value.search,
    });
    await refreshCurrentLyric();
  } catch {
    toast.error(t("lyricManager.selectFailed"));
  } finally {
    candidateActionId.value = null;
  }
};

/** 保存自定义标题/歌手；两个字段均清空即恢复歌曲原始元数据。 */
const applyCustomSearch = async (): Promise<void> => {
  const track = currentTrack();
  if (!track) return;
  const title = customSearchTitle.value.trim();
  const artist = customSearchArtist.value.trim();
  const search = title || artist ? { title, artist } : undefined;
  try {
    await setEffectiveTrackLyricPreference(track, { ...preference.value, search });
    preference.value = { ...preference.value, search };
    customSearchOpen.value = false;
    await refresh(false);
    if (isCurrentTrack.value) await refreshCurrentLyric();
  } catch {
    toast.error(t("lyricManager.refreshFailed"));
  }
};

/** 打开自定义搜索时预填已保存内容，便于修改或清空重置。 */
const openCustomSearch = (): void => {
  customSearchTitle.value = preference.value.search?.title ?? "";
  customSearchArtist.value = preference.value.search?.artist ?? "";
  customSearchOpen.value = true;
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
    if (lyric.format === "ttml" || lyric.format === "ttmlLine") {
      const { missingExplicitSpaces } = normalizeTtml(lyric.content);
      if (missingExplicitSpaces) {
        const proceed = await dialog.confirm({
          title: t("lyricManager.formattedTtmlWarningTitle"),
          content: t("lyricManager.formattedTtmlWarningDescription"),
          type: "warning",
        });
        if (!proceed) return;
      }
    }
    let result = await window.api.lyrics.setManaged(track, lyric);
    if (result.status === "conflict") {
      const overwrite = await dialog.confirm({
        title: t("lyricManager.overwriteTitle"),
        content: t("lyricManager.overwriteDescription", { filename: result.filename }),
        type: "warning",
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
      focusedCandidateId.value = null;
      managed.value = null;
      candidates.value = [];
      preference.value = { source: "auto" };
      syncOpen.value = false;
      syncQuery.value = "";
      syncResults.value = [];
      syncSelected.value = [];
      customSearchOpen.value = false;
      customSearchTitle.value = "";
      customSearchArtist.value = "";
      void refresh();
      return;
    }
    refreshToken++;
    onlineLoading.value = false;
    focusedCandidateId.value = null;
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
    customSearchOpen.value = false;
  },
);
</script>

<template>
  <SDialog
    :open="lyricManager.open.value"
    :title="t(isDatabase ? 'lyricManager.databaseTitle' : 'lyricManager.trackTitle')"
    :description="isDatabase ? t('lyricManager.databaseDescription') : undefined"
    title-tag="Beta"
    variant="settings"
    :width="isDatabase ? 'min(1480px,96vw)' : 'min(1100px,94vw)'"
    height="min(850px,88vh)"
    :content-style="{
      padding: '0 16px 16px',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }"
    destroy-on-close
    @update:open="lyricManager.setOpen"
  >
    <div
      v-if="lyricManager.open.value"
      class="lyric-manager-workspace"
      :class="{ 'with-tracks': isDatabase }"
    >
      <LyricManagerTracks
        v-if="isDatabase"
        :selected="lyricManager.track.value"
        @select="lyricManager.show($event, 'database')"
      />
      <section
        class="flex min-h-0 min-w-0 flex-col gap-3 rounded-xl border border-solid border-outline-variant/15 bg-surface-panel p-3"
      >
        <div
          v-if="lyricManager.track.value"
          class="flex shrink-0 items-center gap-3 border-b border-solid border-outline-variant/15 pb-3"
        >
          <img
            v-if="lyricManager.track.value.cover"
            :src="lyricManager.track.value.cover"
            class="size-12 shrink-0 rounded-lg object-cover"
            decoding="async"
          />
          <IconLucideDisc3 v-else class="size-10 shrink-0 text-on-surface-variant/40" />
          <div class="min-w-0 flex-1">
            <div class="truncate font-semibold">{{ lyricManager.track.value.title }}</div>
            <div class="mt-1 truncate text-xs text-on-surface-variant/65">{{ artistNames }}</div>
          </div>
          <SButton
            v-if="showPlayShortcut"
            variant="ghost"
            circle
            :title="t('songList.context.play')"
            @click="playManagedTrack"
          >
            <template #icon><IconLucidePlay /></template>
          </SButton>
        </div>
        <div class="flex shrink-0 items-center justify-between gap-2">
          <h3 class="m-0 text-base font-semibold">{{ t("lyricManager.sources") }}</h3>
          <SButton
            variant="ghost"
            circle
            size="small"
            :loading="matchLoading || onlineLoading"
            :title="t('lyricManager.refreshLyric')"
            :disabled="!lyricManager.track.value"
            @click="refresh(false)"
          >
            <template #icon><IconLucideRefreshCw /></template>
          </SButton>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto">
          <div v-for="group in candidateGroups" :key="group.name">
            <template v-if="group.items.length">
              <div class="mb-2 mt-2 flex justify-between px-1 text-xs text-on-surface-variant/60">
                <span>{{ group.name }}</span>
                <span>{{ t("lyricManager.versionCount", { count: group.items.length }) }}</span>
              </div>
              <button
                v-for="candidate in group.items"
                :key="candidate.id"
                class="mb-2 w-full cursor-pointer rounded-xl border border-solid p-3 text-left transition-colors"
                :class="
                  focusedCandidate?.id === candidate.id
                    ? 'border-primary/50 bg-primary/8'
                    : isCandidateVisuallySelected(candidate)
                      ? 'border-primary/25 bg-surface'
                      : 'border-outline-variant/15 bg-transparent hover:bg-on-surface/5'
                "
                @click="focusedCandidateId = candidate.id"
                @contextmenu.prevent="candidate.local && deleteCandidate(candidate)"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate text-sm font-semibold text-on-surface">
                    {{ candidateSourceLabel(candidate) }}
                  </span>
                  <STag v-if="usedCandidate?.id === candidate.id" type="primary" size="tiny">
                    {{ t("lyricManager.inUse") }}
                  </STag>
                  <STag v-else-if="isCandidateSmartSelected(candidate)" size="tiny">
                    {{ t("lyricManager.smartSelected") }}
                  </STag>
                </div>
                <div class="my-2 truncate text-xs text-on-surface-variant/65">
                  {{ candidate.filename }}
                </div>
                <div class="flex flex-wrap gap-1">
                  <STag size="tiny">{{ candidate.format.toUpperCase() }}</STag>
                  <STag v-if="candidate.translation" type="primary" size="tiny">
                    {{ t("lyricManager.translationTag") }}
                  </STag>
                  <STag v-if="candidate.romaji" size="tiny">
                    {{ t("lyricManager.pronunciationTag") }}
                  </STag>
                </div>
              </button>
            </template>
          </div>
          <div v-if="lyricManager.track.value && missingSources.length" class="mt-3">
            <div class="mb-2 text-xs text-on-surface-variant/60">
              {{ t("lyricManager.notRetrieved") }}
            </div>
            <div
              v-for="origin in missingSources"
              :key="origin"
              class="mb-2 flex items-center justify-between gap-2 rounded-xl border border-solid border-outline-variant/15 px-3 py-3"
            >
              <span class="text-sm text-on-surface-variant/70">
                {{ t(`lyricManager.matchSource.${origin}`) }}
              </span>
              <SButton
                variant="ghost"
                size="small"
                :loading="onlineLoading"
                @click="refresh(false)"
              >
                {{ t("lyricManager.retrieve") }}
              </SButton>
            </div>
          </div>
          <div v-if="!lyricManager.track.value" class="p-6 text-center text-on-surface-variant/60">
            {{ t("lyricManager.chooseTrack") }}
          </div>
        </div>
        <div
          v-if="lyricManager.track.value"
          class="shrink-0 flex flex-col gap-2 border-t border-solid border-outline-variant/15 pt-3"
        >
          <div class="truncate text-xs text-on-surface-variant/60" :title="currentLyricDescription">
            {{ currentLyricDescription }}
          </div>
          <SButton
            variant="secondary"
            :disabled="smartSelection"
            :loading="candidateActionId === 'smart'"
            @click="selectSmart"
          >
            <template #icon><IconLucideSparkles /></template>
            {{ t(smartSelection ? "lyricManager.smartSelection" : "lyricManager.useAutomatic") }}
          </SButton>
          <div class="flex gap-2">
            <SButton type="primary" class="flex-1" :loading="loading" @click="importLyric">
              <template #icon><IconLucidePlus /></template>
              {{ t("lyricManager.import") }}
            </SButton>
            <SPopover side="top" align="end">
              <template #trigger>
                <SButton variant="secondary" circle :title="t('lyricManager.moreActions')">
                  <template #icon><IconLucideEllipsis /></template>
                </SButton>
              </template>
              <div class="flex min-w-36 flex-col gap-1">
                <SButton variant="ghost" @click="openTrackLyricDirectory">
                  {{ t("lyricManager.openDirectory") }}
                </SButton>
                <SButton variant="ghost" @click="refreshCurrentLyric">
                  {{ t("lyricManager.refreshLyric") }}
                </SButton>
                <SButton v-if="managed" variant="ghost" @click="syncOpen = true">
                  {{ t("lyricManager.syncToTracks") }}
                </SButton>
              </div>
            </SPopover>
          </div>
        </div>
      </section>
      <LyricCandidateDetails
        v-if="focusedCandidate && lyricManager.track.value"
        :key="lyricManager.track.value.source + ':' + lyricManager.track.value.id"
        :candidate="focusedCandidate"
        :track="lyricManager.track.value"
        :source-label="candidateSourceLabel(focusedCandidate)"
        :in-use="usedCandidate?.id === focusedCandidate.id"
        :selected="isCandidateExplicitlySelected(focusedCandidate)"
        :loading="candidateActionId === focusedCandidate.id"
        :can-delete="focusedCandidate.local && usedCandidate?.id !== focusedCandidate.id"
        :source-url="candidateSourceUrl(focusedCandidate)"
        @confirm="selectCandidate(focusedCandidate)"
        @search="openCustomSearch"
        @edit="openOptimize(focusedCandidate)"
        @remove="deleteCandidate(focusedCandidate)"
        @source="openCandidateSourceUrl(focusedCandidate)"
      />
      <div
        v-else
        class="flex min-h-0 items-center justify-center rounded-xl border border-solid border-outline-variant/15 bg-surface-panel p-8 text-center text-on-surface-variant/60"
      >
        {{
          t(matchLoading || onlineLoading ? "lyricManager.matching" : "lyricManager.chooseVersion")
        }}
      </div>
    </div>
  </SDialog>

  <SDialog
    v-model:open="customSearchOpen"
    :title="t('lyricManager.customSearch')"
    variant="settings"
    width="460px"
  >
    <div class="flex flex-col gap-4">
      <p class="text-sm text-on-surface-variant/70">
        {{ t("lyricManager.customSearchDescription") }}
      </p>
      <SInput v-model="customSearchTitle" :placeholder="t('lyricManager.customSearchTitle')" />
      <SInput v-model="customSearchArtist" :placeholder="t('lyricManager.customSearchArtist')" />
    </div>
    <template #footer="{ close }">
      <SButton variant="secondary" @click="close">{{ t("common.cancel") }}</SButton>
      <SButton type="primary" @click="applyCustomSearch">{{ t("common.confirm") }}</SButton>
    </template>
  </SDialog>

  <SDialog
    v-model:open="syncOpen"
    :title="t('lyricManager.syncTitle')"
    variant="settings"
    width="560px"
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
              v-if="track.cover"
              :src="track.cover"
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

  <LyricOptimizeDialog />
</template>

<style scoped>
.lyric-manager-workspace {
  display: grid;
  grid-template-columns: minmax(240px, 0.85fr) minmax(0, 1.4fr);
  gap: 12px;
  flex: 1;
  min-height: 0;
}
.lyric-manager-workspace.with-tracks {
  grid-template-columns: minmax(230px, 0.8fr) minmax(250px, 0.9fr) minmax(0, 1.4fr);
}
@media (max-width: 1000px) {
  .lyric-manager-workspace.with-tracks {
    grid-template-columns: minmax(220px, 0.8fr) minmax(0, 1.2fr);
    grid-template-rows: 300px minmax(560px, 1fr);
    overflow-y: auto;
  }
  .lyric-manager-workspace.with-tracks > :first-child {
    grid-column: 1 / -1;
  }
}
@media (max-width: 620px) {
  .lyric-manager-workspace,
  .lyric-manager-workspace.with-tracks {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: none;
    grid-auto-rows: minmax(560px, auto);
    overflow-y: auto;
  }
  .lyric-manager-workspace.with-tracks > :first-child {
    min-height: 360px;
  }
}
</style>
