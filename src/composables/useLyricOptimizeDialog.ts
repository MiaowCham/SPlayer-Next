import { readonly, ref } from "vue";
import type { Track } from "@shared/types/player";
import type { LyricMatchCandidate } from "@shared/types/lyrics";

const open = ref(false);
const track = ref<Track | null>(null);
const candidate = ref<LyricMatchCandidate | null>(null);

/** 歌词优化（编辑）弹窗控制 */
export const useLyricOptimizeDialog = () => ({
  open: readonly(open),
  track: readonly(track),
  candidate: readonly(candidate),

  /** 打开指定歌词的优化编辑 */
  show: (nextTrack: Track, nextCandidate: LyricMatchCandidate): void => {
    track.value = nextTrack;
    candidate.value = nextCandidate;
    open.value = true;
  },

  /** 关闭优化弹窗 */
  hide: (): void => {
    open.value = false;
  },

  /** 同步弹窗可见性 */
  setOpen: (nextOpen: boolean): void => {
    open.value = nextOpen;
    if (!nextOpen) {
      track.value = null;
      candidate.value = null;
    }
  },
});
