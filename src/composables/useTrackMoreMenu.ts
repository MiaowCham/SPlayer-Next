import type { Ref } from "vue";
import type { Track } from "@shared/types/player";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import { useCopyText } from "@/composables/useCopyText";
import { getTrackShareUrl } from "@/utils/format/shareUrl";
import IconCopy from "~icons/lucide/copy";
import IconMoreHorizontal from "~icons/lucide/more-horizontal";

const MORE_ACTION_KEYS = new Set(["copyTitle", "copyId", "copyUrl"]);

/** 当前歌曲的“更多操作”菜单。 */
export const useTrackMoreMenu = (track: Ref<Track | null | undefined>) => {
  const { t } = useI18n();
  const { copy } = useCopyText();

  const item = computed<DropdownMenuItem>(() => {
    const source = track.value?.source;
    const isLocal = source === "local";
    const isOnline = !!source && source !== "local" && source !== "streaming";
    return {
      key: "more",
      label: t("songList.context.more"),
      icon: markRaw(IconMoreHorizontal),
      children: [
        {
          key: "copyTitle",
          label: t("songList.context.copyTitle"),
          icon: markRaw(IconCopy),
        },
        {
          key: "copyId",
          label: t("songList.context.copyId"),
          icon: markRaw(IconCopy),
          show: !isLocal,
        },
        {
          key: "copyUrl",
          label: t("songList.context.copyUrl"),
          icon: markRaw(IconCopy),
          show: isOnline,
        },
      ],
    };
  });

  /**
   * 处理更多操作，并返回该键是否属于此菜单。
   * @param key - 菜单项键
   * @returns 是否已处理该菜单项
   */
  const handleSelect = async (key: string): Promise<boolean> => {
    if (!MORE_ACTION_KEYS.has(key)) return false;
    const current = track.value;
    if (!current) return true;
    if (key === "copyTitle") await copy(current.title);
    else if (key === "copyId") await copy(current.id);
    else await copy(getTrackShareUrl(current));
    return true;
  };

  return { item, handleSelect };
};
