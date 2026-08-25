import { readonly, ref } from "vue";
import type { Track } from "@shared/types/player";

export type LyricTrackManagerContext = "database" | "context-menu" | "player";

const open = ref(false);
const track = ref<Track | null>(null);
const context = ref<LyricTrackManagerContext>("context-menu");

/** 单曲歌词管理弹窗控制 */
export const useLyricTrackManagerDialog = () => ({
  open: readonly(open),
  track: readonly(track),
  context: readonly(context),

  /** 打开指定歌曲的歌词管理 */
  show: (nextTrack: Track, nextContext: LyricTrackManagerContext = "context-menu"): void => {
    track.value = nextTrack;
    context.value = nextContext;
    open.value = true;
  },

  /** 关闭歌词管理弹窗 */
  hide: (): void => {
    open.value = false;
  },

  /** 同步弹窗可见性 */
  setOpen: (nextOpen: boolean): void => {
    open.value = nextOpen;
    if (!nextOpen) {
      track.value = null;
      context.value = "context-menu";
    }
  },
});
