<script setup lang="ts">
import { PLATFORM_SHORT_NAME, isPlatform } from "@shared/types/platform";
import { useSortable } from "@vueuse/integrations/useSortable";
import { DEFAULT_LYRIC_SOURCE_ORDER, type LyricSourceOrderItem } from "@/types/settings";
import { useSettingsStore } from "@/stores/settings";
import IconLucideGripVertical from "~icons/lucide/grip-vertical";
import IconLucideLockKeyhole from "~icons/lucide/lock-keyhole";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const settings = useSettingsStore();
const open = ref(false);

const list = ref<LyricSourceOrderItem[]>([]);
const listEl = ref<HTMLElement | null>(null);

watch(open, (val) => {
  if (val) list.value = [...settings.lyric.lyricSourceOrder];
});

useSortable(listEl, list, {
  animation: 150,
  forceFallback: true,
  watchElement: true,
  fallbackClass: "sortable-ghost",
});

const labelOf = (v: LyricSourceOrderItem): string => {
  if (isPlatform(v)) return PLATFORM_SHORT_NAME[v] ?? v;
  return t(`settings.lyricSourceOrder.${v}`);
};
const localLabel = computed(() => t("settings.lyricSourcePreference.local"));

const handleConfirm = () => {
  settings.lyric.lyricSourceOrder = [...list.value];
  open.value = false;
};

const handleReset = () => {
  list.value = [...DEFAULT_LYRIC_SOURCE_ORDER];
};
</script>

<template>
  <SButton type="primary" variant="secondary" size="small" @click="open = true">
    {{ t("common.configure") }}
  </SButton>
  <SDialog
    v-model:open="open"
    :title="t('settings.lyricSourceOrder.label')"
    :description="t('settings.lyricSourceOrder.hint')"
    width="420px"
  >
    <div class="flex flex-col gap-2.5">
      <SCard variant="settings" class="flex items-center gap-3 opacity-75">
        <span class="w-5 text-center text-xs text-on-surface-variant/60 font-medium">1</span>
        <span class="text-sm flex-1">{{ localLabel }}</span>
        <IconLucideLockKeyhole class="text-on-surface-variant/40" />
      </SCard>
      <div ref="listEl" class="flex flex-col gap-2.5">
        <SCard
          v-for="(item, idx) in list"
          :key="item"
          variant="settings"
          class="flex items-center gap-3 cursor-grab active:cursor-grabbing"
        >
          <span class="w-5 text-center text-xs text-on-surface-variant/60 font-medium">
            {{ idx + 2 }}
          </span>
          <span class="text-sm flex-1">{{ labelOf(item) }}</span>
          <IconLucideGripVertical class="text-on-surface-variant/40" />
        </SCard>
      </div>
    </div>
    <template #footer="{ close }">
      <SButton variant="secondary" @click="handleReset">{{ t("common.reset") }}</SButton>
      <SButton variant="secondary" @click="close">{{ t("common.cancel") }}</SButton>
      <SButton type="primary" @click="handleConfirm">{{ t("common.confirm") }}</SButton>
    </template>
  </SDialog>
</template>
