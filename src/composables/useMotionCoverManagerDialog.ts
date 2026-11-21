import type { Ref } from "vue";

/** 动态封面管理框的全局状态 */
const open = ref(false);
const keyword = ref("");

export const useMotionCoverManagerDialog = (): {
  open: Ref<boolean>;
  keyword: Ref<string>;
  show: (nextKeyword?: string) => void;
} => ({
  open,
  keyword,
  /**
   * 打开动态封面管理，可带入曲名作为搜索词
   * @param nextKeyword - 可选搜索词
   */
  show: (nextKeyword = ""): void => {
    keyword.value = nextKeyword;
    open.value = true;
  },
});
