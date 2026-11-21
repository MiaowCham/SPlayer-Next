import type { Ref } from "vue";
import type { Track } from "@shared/types/player";

/** 动态封面管理框的全局状态 */
const open = ref(false);
const keyword = ref("");
const track = shallowRef<Track | null>(null);

export const useMotionCoverManagerDialog = (): {
  open: Ref<boolean>;
  keyword: Ref<string>;
  track: Ref<Track | null>;
  show: (nextTrack?: Track | null, nextKeyword?: string) => void;
} => ({
  open,
  keyword,
  track,
  /**
   * 打开动态封面管理
   * @param nextTrack - 当前曲目，设置页打开时为空
   * @param nextKeyword - 可选搜索词
   */
  show: (nextTrack: Track | null = null, nextKeyword = ""): void => {
    track.value = nextTrack;
    keyword.value = nextKeyword;
    open.value = true;
  },
});
