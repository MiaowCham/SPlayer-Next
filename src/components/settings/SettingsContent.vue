<script setup lang="ts">
import { settingsSchema } from "@/settings/schema";
import { useSettingsDialog } from "@/settings/useSettingsDialog";
import { useSettingsStore } from "@/stores/settings";
import { openExternal } from "@/utils/url";
import { REPO_URL, REPO_NAME, APP_VERSION, IS_APPX } from "@/utils/config";

const { open, initialCategory, initialHighlight, rememberCategory } = useSettingsDialog();

// 同步后端配置
useSettingsStore().syncSystem();
const { t } = useI18n();

const activeId = ref(initialCategory.value);
const highlightKey = ref(initialHighlight.value);
const scrollRef = ref<HTMLElement>();
const isSearchActive = ref(false);

const visibleCategories = computed(() =>
  settingsSchema.filter((category) => category.visible?.() ?? true),
);
const activeCategory = computed(() =>
  visibleCategories.value.find((category) => category.id === activeId.value),
);

/** 计算每个 section 的全局起始索引 */
const sectionStartIndices = computed(() => {
  const indices: number[] = [];
  let idx = 0;
  for (const sec of activeCategory.value?.sections ?? []) {
    indices.push(idx);
    idx += 1 + sec.items.length;
  }
  return indices;
});

const onCategorySelect = (id: string) => {
  activeId.value = id;
  highlightKey.value = undefined;
  rememberCategory(id);
  nextTick(() => scrollRef.value?.scrollTo({ top: 0 }));
};

const onSearchSelect = (categoryId: string, itemKey: string) => {
  highlightKey.value = itemKey;
  if (activeId.value !== categoryId) {
    activeId.value = categoryId;
  }
  nextTick(() => {
    setTimeout(() => {
      const el = document.getElementById(`setting-${itemKey}`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      setTimeout(() => {
        highlightKey.value = undefined;
      }, 2500);
    }, 100);
  });
};

/** 每次从外部打开设置时重新应用分类与高亮目标。 */
const applyInitialTarget = (): void => {
  if (!visibleCategories.value.some((category) => category.id === initialCategory.value)) return;
  if (initialHighlight.value) {
    onSearchSelect(initialCategory.value, initialHighlight.value);
    return;
  }
  activeId.value = initialCategory.value;
  highlightKey.value = undefined;
  nextTick(() => scrollRef.value?.scrollTo({ top: 0 }));
};

watch(
  [open, initialCategory, initialHighlight],
  ([isOpen]) => {
    if (isOpen) applyInitialTarget();
  },
  { flush: "post", immediate: true },
);

watch(
  visibleCategories,
  (categories) => {
    if (categories.some((category) => category.id === activeId.value)) return;
    const fallback = categories[0];
    if (!fallback) return;
    activeId.value = fallback.id;
    highlightKey.value = undefined;
    rememberCategory(fallback.id);
  },
  { flush: "sync", immediate: true },
);
</script>

<template>
  <div class="flex h-full overflow-hidden">
    <!-- 左侧 -->
    <div class="w-70 shrink-0 flex flex-col bg-surface-panel p-5">
      <h2 class="text-2xl font-bold mb-1 px-1">{{ t("settings.title") }}</h2>
      <p class="text-sm text-on-surface-variant/80 mb-5 px-1">{{ t("settings.subtitle") }}</p>

      <!-- 搜索 -->
      <SettingsSearch
        class="mb-4"
        @select="onSearchSelect"
        @active-change="isSearchActive = $event"
      />

      <!-- 菜单 -->
      <Transition name="fade">
        <div v-show="!isSearchActive" class="flex-1 min-h-0 overflow-y-auto -mr-5 pr-5">
          <SettingsMenu
            :categories="visibleCategories"
            :active-id="activeId"
            @select="onCategorySelect"
          />
        </div>
      </Transition>

      <!-- 底部 -->
      <div class="shrink-0 mt-auto pt-4 px-1 flex items-center gap-1">
        <SButton variant="text" size="tiny" @click="openExternal(REPO_URL)">
          <template #icon><IconLucideGithub /></template>
          {{ REPO_NAME }}
        </SButton>
        <STag size="tiny">v{{ APP_VERSION }}</STag>
        <STag v-if="IS_APPX" size="tiny">{{ t("settings.storeVersion") }}</STag>
      </div>
    </div>

    <!-- 右侧 -->
    <div ref="scrollRef" class="flex-1 overflow-y-auto bg-surface py-6 px-8">
      <div v-if="activeCategory" :key="activeCategory.id" class="animate-fade-in">
        <component :is="activeCategory.component" v-if="activeCategory.component" />
        <template v-else>
          <h2
            v-if="activeCategory.tag"
            class="mb-6 flex items-center gap-2 px-1 text-2xl font-bold text-on-surface"
          >
            {{ t(`settings.group.${activeCategory.id}`) }}
            <STag :type="activeCategory.tag.type ?? 'primary'">
              {{ activeCategory.tag.text }}
            </STag>
          </h2>
          <SettingsSection
            v-for="(sec, si) in activeCategory.sections"
            :key="sec.id"
            :section="sec"
            :highlight-key="highlightKey"
            :start-index="sectionStartIndices[si] ?? 0"
          />
        </template>
      </div>
    </div>
  </div>
</template>
