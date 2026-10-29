<script setup lang="ts">
import { useDeviceLatencyDialog } from "@/composables/useDeviceLatencyDialog";
defineOptions({ inheritAttrs: false });
const { t } = useI18n();
const manager = useDeviceLatencyDialog();
</script>
<template>
  <SButton variant="secondary" @click="manager.show">{{ t("deviceLatency.manage") }}</SButton>
</template>
