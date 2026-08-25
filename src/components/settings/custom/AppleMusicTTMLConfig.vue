<script setup lang="ts">
import { toast } from "@/composables/useToast";
import { useSettingsStore } from "@/stores/settings";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const settings = useSettingsStore();
const open = ref(false);
const hasToken = ref(false);
const mediaUserToken = ref("");
const storefront = ref("");
const searchRegions = ref("");
const translationLanguage = ref("");
const translationScript = ref("");

/** 打开对话框时读取当前非敏感配置与令牌存在状态。 */
const show = async (): Promise<void> => {
  hasToken.value = (await window.api.lyrics.getAppleMusicTTMLStatus()).hasMediaUserToken;
  storefront.value = settings.system.lyric.appleMusicStorefront;
  searchRegions.value = settings.system.lyric.appleMusicSearchRegions;
  translationLanguage.value = settings.system.lyric.appleMusicTranslationLanguage;
  translationScript.value = settings.system.lyric.appleMusicTranslationScript;
  mediaUserToken.value = "";
  open.value = true;
};

/** 保存令牌与非敏感的检索、语言配置。 */
const save = async (): Promise<void> => {
  try {
    if (mediaUserToken.value.trim()) {
      hasToken.value = (
        await window.api.lyrics.setAppleMusicMediaUserToken(mediaUserToken.value)
      ).hasMediaUserToken;
    }
    await Promise.all([
      settings.setSystem("lyric.appleMusicStorefront", storefront.value.trim()),
      settings.setSystem("lyric.appleMusicSearchRegions", searchRegions.value.trim()),
      settings.setSystem("lyric.appleMusicTranslationLanguage", translationLanguage.value.trim()),
      settings.setSystem("lyric.appleMusicTranslationScript", translationScript.value.trim()),
    ]);
    open.value = false;
    toast.success(t("settings.appleMusicTTMLConfig.saved"));
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : t("settings.appleMusicTTMLConfig.saveFailed"),
    );
  }
};
</script>

<template>
  <SButton type="primary" variant="secondary" size="small" @click="show">
    {{ t("common.configure") }}
  </SButton>
  <SDialog v-model:open="open" :title="t('settings.appleMusicTTMLConfig.label')" width="560px">
    <div class="flex flex-col gap-3 text-sm">
      <p class="text-amber-500">{{ t("settings.appleMusicTTMLConfig.warning") }}</p>
      <p class="text-on-surface-variant">{{ t("settings.appleMusicTTMLConfig.tokenHint") }}</p>
      <SInput
        v-model="mediaUserToken"
        type="password"
        :placeholder="t('settings.appleMusicTTMLConfig.tokenPlaceholder')"
      />
      <p class="text-xs text-on-surface-variant">
        {{
          hasToken
            ? t("settings.appleMusicTTMLConfig.tokenSaved")
            : t("settings.appleMusicTTMLConfig.tokenMissing")
        }}
      </p>
      <SInput
        v-model="storefront"
        :placeholder="t('settings.appleMusicTTMLConfig.storefrontPlaceholder')"
      />
      <SInput
        v-model="searchRegions"
        :placeholder="t('settings.appleMusicTTMLConfig.regionsPlaceholder')"
      />
      <SInput
        v-model="translationLanguage"
        :placeholder="t('settings.appleMusicTTMLConfig.languagePlaceholder')"
      />
      <SInput
        v-model="translationScript"
        :placeholder="t('settings.appleMusicTTMLConfig.scriptPlaceholder')"
      />
    </div>
    <template #footer="{ close }">
      <SButton variant="secondary" @click="close">{{ t("common.cancel") }}</SButton>
      <SButton type="primary" @click="save">{{ t("common.save") }}</SButton>
    </template>
  </SDialog>
</template>
