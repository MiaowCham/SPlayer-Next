<script setup lang="ts">
import { useMotionCoverManagerDialog } from "@/composables/useMotionCoverManagerDialog";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const manager = useMotionCoverManagerDialog();
</script>

<template>
  <SButton variant="secondary" @click="manager.show()">
    {{ t("motionCoverManager.open") }}
  </SButton>
</template>
