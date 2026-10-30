<script setup lang="ts">
import type { LyricLine, LyricMatchCandidate } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import type { LyricPreviewState } from "@shared/types/lyricPreview";
import { normalizeLyricOffset } from "@shared/utils/lyricVersion";
import { getPresentationTime } from "@shared/utils/presentationTime";
import { resolveTrackSource } from "@/services/audioSource";
import { useStatusStore } from "@/stores/status";
import { formatTime } from "@/utils/time";
import { toast } from "@/composables/useToast";

const props = defineProps<{
  open: boolean;
  calibrating: boolean;
  candidate: LyricMatchCandidate;
  track: Track;
  lines: LyricLine[];
}>();
const emit = defineEmits<{ "update:open": [open: boolean] }>();
const { t } = useI18n();
const status = useStatusStore();
const visibility = useDocumentVisibility();
const engine = ref<{ setCurrentTime(time: number, seeking?: boolean): void }>();
const time = ref(0);
const duration = ref(1);
const playing = ref(false);
const loading = ref(false);
const ready = ref(false);
const saving = ref(false);
const busy = ref(false);
const error = ref(false);
const offset = ref(0);
let sessionId: string | null = null;
let anchor = { time: 0, at: 0 };
let unsubscribe: (() => void) | undefined;

/** 更新歌词位置，校准只使用当前版本的偏移草稿 */
const renderTime = (seeking = false): void => {
  engine.value?.setCurrentTime(
    getPresentationTime(time.value, offset.value, status.deviceLatencyMs, 1),
    seeking,
  );
};
const { pause, resume } = useRafFn(
  () => {
    time.value = Math.min(duration.value, anchor.time + performance.now() - anchor.at);
    renderTime();
  },
  { immediate: false },
);

/**
 * 接收属于本次打开的原生试听快照
 * @param state - 独立播放器状态
 */
const receive = (state: LyricPreviewState): void => {
  if (state.sessionId !== sessionId) return;
  ready.value = state.ready;
  playing.value = state.playing;
  duration.value = state.duration;
  if (!busy.value) {
    time.value = state.position;
    anchor = { time: state.position, at: performance.now() };
    renderTime();
  }
  if (state.error) error.value = true;
};

/** 停止试听、释放订阅及动画，并让主进程恢复被试听暂停的主播放 */
const close = (): void => {
  const id = sessionId;
  sessionId = null;
  pause();
  unsubscribe?.();
  unsubscribe = undefined;
  playing.value = false;
  ready.value = false;
  loading.value = false;
  busy.value = false;
  if (id) void window.api.lyricPreview.close(id).catch(() => {});
};

/** 打开试听并解析所选曲目的音源，不调用主播放器的加载或定位接口 */
const startPreview = async (): Promise<void> => {
  close();
  const id = crypto.randomUUID();
  sessionId = id;
  const track = toRaw(props.track);
  const candidate = toRaw(props.candidate);
  time.value = 0;
  duration.value = track.duration || 1;
  offset.value = 0;
  error.value = false;
  loading.value = true;
  unsubscribe = window.api.lyricPreview.onState(receive);
  try {
    const saved = await window.api.lyrics.getVersionOffset(track, candidate);
    if (sessionId !== id) return;
    offset.value = saved;
    const source = await resolveTrackSource(track, { silent: true });
    if (sessionId !== id) return;
    if (!source) throw new Error("音源不可用");
    const state = await window.api.lyricPreview.open(id, track, source.source);
    if (sessionId !== id) {
      await window.api.lyricPreview.close(id);
      return;
    }
    receive(state);
  } catch {
    if (sessionId === id) error.value = true;
  } finally {
    if (sessionId === id) loading.value = false;
  }
};

/**
 * 操作独立播放器，异步结果只更新原会话
 * @param action - 播放、暂停或定位
 * @param value - 定位毫秒数
 */
const control = async (action: "play" | "pause" | "seek", value?: number): Promise<void> => {
  const id = sessionId;
  if (!id || !ready.value || busy.value) return;
  busy.value = true;
  pause();
  try {
    const state = await window.api.lyricPreview.control(id, action, value);
    if (sessionId === id && state) {
      busy.value = false;
      receive(state);
      if (action === "seek") renderTime(true);
    }
  } catch {
    if (sessionId === id) error.value = true;
  } finally {
    if (sessionId === id) busy.value = false;
  }
};

/** 保存当前版本偏移，失败时保留草稿供重试 */
const save = async (): Promise<void> => {
  if (saving.value) return;
  const id = sessionId;
  saving.value = true;
  try {
    await window.api.lyrics.setVersionOffset(
      toRaw(props.track),
      toRaw(props.candidate),
      offset.value,
    );
    if (sessionId === id) {
      toast.success(t("lyricManager.offsetSaved"));
      emit("update:open", false);
    }
  } catch {
    toast.error(t("lyricManager.offsetSaveFailed"));
  } finally {
    saving.value = false;
  }
};

watch([playing, visibility, busy], ([play, visible, pending]) => {
  if (play && visible === "visible" && !pending) resume();
  else pause();
});
watch(offset, () => renderTime(true));
watch(visibility, (value) => {
  if (value === "hidden" && props.open) {
    close();
    emit("update:open", false);
  }
});
watch(
  () => props.open,
  (value) => (value ? void startPreview() : close()),
  { immediate: true },
);
onBeforeUnmount(close);
</script>

<template>
  <SDialog
    :open="open"
    :title="t(calibrating ? 'lyricManager.adjustOffset' : 'lyricManager.effectPreview')"
    width="min(900px,90vw)"
    @update:open="emit('update:open', $event)"
  >
    <div class="text-sm font-medium truncate">{{ track.title }}</div>
    <p v-if="calibrating" class="text-xs text-on-surface-variant/65">
      {{ t("lyricManager.offsetDescription") }}
    </p>
    <div class="h-[48vh] min-h-60 overflow-hidden rounded-xl bg-surface-panel">
      <Lyrics
        ref="engine"
        class="h-full w-full text-3xl"
        :lyric-lines="lines"
        :playing="playing"
        :initial-time="0"
        @ready="renderTime(true)"
        @seek="control('seek', Math.max(0, $event - offset + status.deviceLatencyMs))"
      />
    </div>
    <p v-if="error" role="status" class="text-xs text-error">
      {{ t("lyricManager.previewFailed") }}
    </p>
    <div class="mt-3 flex items-center gap-3">
      <SButton
        variant="secondary"
        circle
        :loading="loading"
        :disabled="!ready || busy"
        :title="t(playing ? 'lyricManager.pausePreview' : 'lyricManager.playPreview')"
        @click="control(playing ? 'pause' : 'play')"
      >
        <template #icon>
          <IconLucidePause v-if="playing" />
          <IconLucidePlay v-else />
        </template>
      </SButton>
      <SSlider
        class="flex-1"
        :model-value="time"
        :min="0"
        :max="duration"
        :step="1"
        :disabled="!ready || busy"
        @change="control('seek', $event)"
      />
      <time class="text-xs tabular-nums">{{ formatTime(time) }} / {{ formatTime(duration) }}</time>
    </div>
    <div v-if="calibrating" class="mt-4 flex flex-wrap items-center justify-center gap-2">
      <SButton variant="secondary" @click="offset = normalizeLyricOffset(offset - 100)">
        −100 ms
      </SButton>
      <label class="flex items-center gap-2 text-sm">
        {{ t("lyricManager.versionOffset") }}
        <SNumberInput
          class="w-44"
          :model-value="offset"
          :min="-60000"
          :max="60000"
          :step="100"
          unit="ms"
          update-on="blur"
          @update:model-value="offset = normalizeLyricOffset($event ?? 0)"
        />
      </label>
      <SButton variant="secondary" @click="offset = normalizeLyricOffset(offset + 100)">
        +100 ms
      </SButton>
      <SButton variant="ghost" @click="offset = 0">{{ t("common.reset") }}</SButton>
    </div>
    <template #footer>
      <SButton variant="secondary" @click="emit('update:open', false)">
        {{ t("common.close") }}
      </SButton>
      <SButton
        v-if="calibrating"
        type="primary"
        :loading="saving"
        :disabled="loading"
        @click="save"
      >
        {{ t("common.save") }}
      </SButton>
    </template>
  </SDialog>
</template>
