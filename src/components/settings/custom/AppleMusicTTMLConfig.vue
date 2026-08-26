<script setup lang="ts">
import { toast } from "@/composables/useToast";
import { useSettingsStore } from "@/stores/settings";
import type { AppleMusicTTMLFetchResult } from "@shared/types/lyrics";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const settings = useSettingsStore();
const open = ref(false);
const hasToken = ref(false);
const testing = ref(false);
const testResult = ref<AppleMusicTTMLFetchResult | null>(null);
const mediaUserToken = ref("");
const tokenStorage = ref<"secure" | "compatibility">("secure");
const storefront = ref("");
const matchLevel = ref<"strict" | "standard" | "loose">("standard");
const searchRegions = ref("");
const translationLanguage = ref("");
const translationScript = ref("");

const matchLevelOptions = computed(() =>
  (["strict", "standard", "loose"] as const).map((value) => ({
    value,
    label: t(`settings.appleMusicTTMLConfig.matchLevel.${value}`),
  })),
);

const tokenStorageOptions = computed(() =>
  (["secure", "compatibility"] as const).map((value) => ({
    value,
    label: t(`settings.appleMusicTTMLConfig.storage.${value}.label`),
  })),
);

const testStatusText = computed(() =>
  testResult.value
    ? t(`settings.appleMusicTTMLConfig.testStatus.${testResult.value.status}`, {
        storefront: testResult.value.message ?? "",
      })
    : "",
);

/** 对已安全保存的令牌发起一次真实的账号地区与搜索验证。 */
const verifySavedToken = async (): Promise<void> => {
  if (!hasToken.value) return;
  testing.value = true;
  testResult.value = null;
  try {
    testResult.value = await window.api.lyrics.verifyAppleMusicTTMLToken();
  } catch {
    testResult.value = { lyric: null, status: "error" };
  } finally {
    testing.value = false;
  }
};

/** 打开对话框时读取当前非敏感配置，并验证已保存令牌。 */
const show = async (): Promise<void> => {
  const status = await window.api.lyrics.getAppleMusicTTMLStatus();
  hasToken.value = status.hasMediaUserToken;
  tokenStorage.value = status.hasMediaUserToken
    ? status.storage
    : (settings.system.lyric.appleMusicTokenStorage ?? "secure");
  storefront.value = settings.system.lyric.appleMusicStorefront;
  matchLevel.value = settings.system.lyric.appleMusicMatchLevel ?? "standard";
  searchRegions.value = settings.system.lyric.appleMusicSearchRegions;
  translationLanguage.value = settings.system.lyric.appleMusicTranslationLanguage;
  translationScript.value = settings.system.lyric.appleMusicTranslationScript;
  mediaUserToken.value = "";
  open.value = true;
  void verifySavedToken();
};

/** 保存令牌与非敏感的检索、语言配置。 */
const save = async (): Promise<void> => {
  try {
    if (mediaUserToken.value.trim()) {
      hasToken.value = (
        await window.api.lyrics.setAppleMusicMediaUserToken(
          mediaUserToken.value,
          tokenStorage.value,
        )
      ).hasMediaUserToken;
    } else if (hasToken.value) {
      hasToken.value = (
        await window.api.lyrics.migrateAppleMusicMediaUserToken(tokenStorage.value)
      ).hasMediaUserToken;
    }
    await Promise.all([
      settings.setSystem("lyric.appleMusicTokenStorage", tokenStorage.value),
      settings.setSystem("lyric.appleMusicStorefront", storefront.value.trim()),
      settings.setSystem("lyric.appleMusicMatchLevel", matchLevel.value),
      settings.setSystem("lyric.appleMusicSearchRegions", searchRegions.value.trim()),
      settings.setSystem("lyric.appleMusicTranslationLanguage", translationLanguage.value.trim()),
      settings.setSystem("lyric.appleMusicTranslationScript", translationScript.value.trim()),
    ]);
    toast.success(t("settings.appleMusicTTMLConfig.saved"));
    await verifySavedToken();
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
      <SCard
        class="flex items-start gap-3 border border-solid border-primary/30 bg-primary/5 p-3"
        variant="settings"
      >
        <IconLucideShieldCheck class="mt-0.5 size-5 shrink-0 text-primary" />
        <div class="min-w-0">
          <div class="font-medium">{{ t("settings.appleMusicTTMLConfig.tokenCard.title") }}</div>
          <div class="mt-1 text-xs text-on-surface-variant/70">
            {{ t("settings.appleMusicTTMLConfig.tokenHint") }}
          </div>
        </div>
      </SCard>

      <SCard
        class="flex items-center gap-3 p-3"
        :class="hasToken ? 'border border-solid border-success/35 bg-success/5' : ''"
        variant="settings"
      >
        <IconLucideKeyRound
          class="size-5 shrink-0"
          :class="hasToken ? 'text-success' : 'text-on-surface-variant/60'"
        />
        <div class="min-w-0 flex-1">
          <div class="font-medium">
            {{
              hasToken
                ? t(`settings.appleMusicTTMLConfig.tokenSaved.${tokenStorage}`)
                : t("settings.appleMusicTTMLConfig.tokenMissing")
            }}
          </div>
          <div v-if="hasToken" class="mt-0.5 text-xs text-on-surface-variant/70">
            {{ testing ? t("settings.appleMusicTTMLConfig.testing") : testStatusText }}
          </div>
        </div>
        <SButton
          v-if="hasToken"
          variant="secondary"
          size="small"
          :loading="testing"
          @click="verifySavedToken"
        >
          {{ t("settings.appleMusicTTMLConfig.test") }}
        </SButton>
      </SCard>

      <SCard variant="settings" class="flex flex-col gap-2 p-3">
        <div class="font-medium">{{ t("settings.appleMusicTTMLConfig.tokenCard.inputTitle") }}</div>
        <div class="text-xs text-on-surface-variant/70">
          {{ t("settings.appleMusicTTMLConfig.tokenCard.inputDescription") }}
        </div>
        <SInput
          v-model="mediaUserToken"
          type="password"
          :placeholder="t('settings.appleMusicTTMLConfig.tokenPlaceholder')"
        />
      </SCard>

      <SCard variant="settings" class="flex items-center gap-4 p-3">
        <div class="min-w-0 flex-1">
          <div class="font-medium">{{ t("settings.appleMusicTTMLConfig.storage.title") }}</div>
          <div class="mt-0.5 text-xs text-on-surface-variant/70">
            {{ t(`settings.appleMusicTTMLConfig.storage.${tokenStorage}.description`) }}
          </div>
        </div>
        <SSelect v-model="tokenStorage" class="w-52 shrink-0" :options="tokenStorageOptions" />
      </SCard>

      <SCard variant="settings" class="flex items-center gap-4 p-3">
        <div class="min-w-0 flex-1">
          <div class="font-medium">{{ t("settings.appleMusicTTMLConfig.storefront.title") }}</div>
          <div class="mt-0.5 text-xs text-on-surface-variant/70">
            {{ t("settings.appleMusicTTMLConfig.storefront.description") }}
          </div>
        </div>
        <SInput
          v-model="storefront"
          class="w-52 shrink-0"
          :placeholder="t('settings.appleMusicTTMLConfig.storefrontPlaceholder')"
        />
      </SCard>
      <SCard variant="settings" class="flex items-center gap-4 p-3">
        <div class="min-w-0 flex-1">
          <div class="font-medium">{{ t("settings.appleMusicTTMLConfig.matchLevel.title") }}</div>
          <div class="mt-0.5 text-xs text-on-surface-variant/70">
            {{ t("settings.appleMusicTTMLConfig.matchLevel.description") }}
          </div>
        </div>
        <SSelect v-model="matchLevel" class="w-52 shrink-0" :options="matchLevelOptions" />
      </SCard>
      <SCard variant="settings" class="flex items-center gap-4 p-3">
        <div class="min-w-0 flex-1">
          <div class="font-medium">{{ t("settings.appleMusicTTMLConfig.regions.title") }}</div>
          <div class="mt-0.5 text-xs text-on-surface-variant/70">
            {{ t("settings.appleMusicTTMLConfig.regions.description") }}
          </div>
        </div>
        <SInput
          v-model="searchRegions"
          class="w-52 shrink-0"
          :placeholder="t('settings.appleMusicTTMLConfig.regionsPlaceholder')"
        />
      </SCard>
      <SCard variant="settings" class="flex items-center gap-4 p-3">
        <div class="min-w-0 flex-1">
          <div class="font-medium">{{ t("settings.appleMusicTTMLConfig.language.title") }}</div>
          <div class="mt-0.5 text-xs text-on-surface-variant/70">
            {{ t("settings.appleMusicTTMLConfig.language.description") }}
          </div>
        </div>
        <SInput
          v-model="translationLanguage"
          class="w-52 shrink-0"
          :placeholder="t('settings.appleMusicTTMLConfig.languagePlaceholder')"
        />
      </SCard>
      <SCard variant="settings" class="flex items-center gap-4 p-3">
        <div class="min-w-0 flex-1">
          <div class="font-medium">{{ t("settings.appleMusicTTMLConfig.script.title") }}</div>
          <div class="mt-0.5 text-xs text-on-surface-variant/70">
            {{ t("settings.appleMusicTTMLConfig.script.description") }}
          </div>
        </div>
        <SInput
          v-model="translationScript"
          class="w-52 shrink-0"
          :placeholder="t('settings.appleMusicTTMLConfig.scriptPlaceholder')"
        />
      </SCard>
    </div>
    <template #footer="{ close }">
      <SButton variant="secondary" @click="close">{{ t("common.cancel") }}</SButton>
      <SButton type="primary" @click="save">{{ t("common.save") }}</SButton>
    </template>
  </SDialog>
</template>
