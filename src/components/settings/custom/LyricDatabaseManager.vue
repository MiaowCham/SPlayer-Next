<script setup lang="ts">
import { useLyricTrackManagerDialog } from "@/composables/useLyricTrackManagerDialog";
defineOptions({ inheritAttrs: false });
const { t } = useI18n();
const manager = useLyricTrackManagerDialog();
</script>
<template>
  <SButton variant="secondary" @click="manager.showDatabase">
    {{ t("lyricManager.openDatabase") }}
  </SButton>
</template>
