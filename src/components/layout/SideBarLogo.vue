<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";

defineProps<{
  collapsed: boolean;
}>();

const router = useRouter();
const { t } = useI18n();
const { appearance } = useSettingsStore();

const handleClick = (): void => {
  if (appearance.sidebarShortcutToggle) {
    appearance.sidebarCollapsed = !appearance.sidebarCollapsed;
    return;
  }
  router.push("/");
};

const actionLabel = computed(() =>
  appearance.sidebarShortcutToggle ? t("settings.sidebarShortcutToggle.label") : t("nav.home"),
);
</script>

<template>
  <div class="flex items-center justify-center h-16 shrink-0 px-4">
    <div
      role="button"
      tabindex="0"
      class="inline-flex items-center cursor-pointer transform-gpu transition-transform duration-300 hover:scale-105 active:scale-100"
      :aria-label="actionLabel"
      :title="actionLabel"
      @click="handleClick"
      @keydown.enter="handleClick"
      @keydown.space.prevent="handleClick"
    >
      <SLogo :size="30" class="shrink-0" />
      <span
        class="text-[22px] text-primary mt-0.5 leading-10 overflow-hidden whitespace-nowrap font-logo transition-[width,opacity,margin] duration-300"
        :class="collapsed ? 'w-0 opacity-0 ml-0' : 'w-[90px] ml-2'"
      >
        SPlayer
      </span>
    </div>
  </div>
</template>
