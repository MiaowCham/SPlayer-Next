<script setup lang="ts">
import { useDeviceLatencyDialog } from "@/composables/useDeviceLatencyDialog";
import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import { getActiveDeviceId, refreshDevices } from "@/core/player";
import { getDeviceLatency, setDeviceLatencyOverride } from "@/services/deviceLatency";
import { toast } from "@/composables/useToast";
import { normalizeDeviceLatency } from "@shared/utils/presentationTime";
const { t } = useI18n();
const manager = useDeviceLatencyDialog();
const settings = useSettingsStore();
const status = useStatusStore();
const refreshing = ref(false);
const activeId = computed(getActiveDeviceId);
const currentLatency = computed(() => getDeviceLatency(activeId.value));
const defaultLatency = computed({
  get: () => settings.player.deviceLatencyDefault,
  set: (value: number | null) => {
    settings.player.deviceLatencyDefault = normalizeDeviceLatency(value ?? 0);
  },
});
const devices = computed(() => {
  const rows = status.outputDevices.map((device) => ({ ...device, connected: true }));
  for (const id of Object.keys(settings.player.deviceLatencies)) {
    if (!rows.some((device) => device.id === id))
      rows.push({ id, name: t("deviceLatency.disconnected"), isDefault: false, connected: false });
  }
  return rows;
});
/** 刷新当前可用的输出设备 */
const refresh = async (): Promise<void> => {
  refreshing.value = true;
  try {
    await refreshDevices();
  } catch {
    toast.error(t("deviceLatency.refreshFailed"));
  } finally {
    refreshing.value = false;
  }
};
/** 切换设备使用默认或独立延迟
 * @param id - 设备标识
 * @param mode - 延迟模式
 */
const changeMode = (id: string, mode: string | number | boolean): void =>
  setDeviceLatencyOverride(id, mode === "custom" ? getDeviceLatency(id) : null);
watch(manager.open, (value) => {
  if (value) void refresh();
});
</script>
<template>
  <SDialog
    :open="manager.open.value"
    :title="t('deviceLatency.title')"
    :description="t('deviceLatency.description')"
    variant="settings"
    width="min(760px,94vw)"
    destroy-on-close
    @update:open="manager.setOpen"
  >
    <div v-if="manager.open.value" class="flex flex-col gap-4">
      <div
        class="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-solid border-outline-variant/15 bg-surface-panel p-4"
      >
        <div class="flex items-center gap-3">
          <IconLucideRadio class="size-6 text-primary" />
          <div>
            <div class="font-medium">{{ t("deviceLatency.default") }}</div>
            <div class="mt-1 text-xs text-on-surface-variant/60">
              {{ t("deviceLatency.defaultHint") }}
            </div>
          </div>
        </div>
        <SNumberInput v-model="defaultLatency" class="w-36" :min="0" :step="1" unit="ms" />
      </div>
      <h3 class="mb-0 mt-1 text-base font-semibold">{{ t("deviceLatency.devices") }}</h3>
      <div class="flex max-h-[48vh] flex-col gap-2 overflow-y-auto">
        <div
          v-for="device in devices"
          :key="device.id"
          class="flex flex-wrap items-center gap-3 rounded-xl border border-solid border-outline-variant/15 bg-surface-panel p-4"
        >
          <IconLucideSpeaker
            class="size-6 shrink-0"
            :class="device.connected ? 'text-primary' : 'text-on-surface-variant/40'"
          />
          <div class="min-w-40 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate font-medium">{{ device.name }}</span>
              <STag v-if="device.id === activeId" type="primary" size="tiny">
                {{ t("deviceLatency.current") }}
              </STag>
            </div>
            <div class="mt-1 break-all text-xs text-on-surface-variant/50">{{ device.id }}</div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <div class="w-28 shrink-0">
              <SSelect
                :model-value="
                  Object.hasOwn(settings.player.deviceLatencies, device.id) ? 'custom' : 'default'
                "
                :options="[
                  { value: 'default', label: t('deviceLatency.inherit') },
                  { value: 'custom', label: t('deviceLatency.custom') },
                ]"
                @update:model-value="changeMode(device.id, $event)"
              />
            </div>
            <SNumberInput
              v-if="Object.hasOwn(settings.player.deviceLatencies, device.id)"
              class="w-36 shrink-0"
              :model-value="getDeviceLatency(device.id)"
              :min="0"
              :step="1"
              unit="ms"
              @update:model-value="setDeviceLatencyOverride(device.id, $event ?? 0)"
            />
          </div>
        </div>
        <div v-if="!devices.length" class="p-8 text-center text-on-surface-variant/60">
          {{ t("deviceLatency.noDevices") }}
        </div>
      </div>
    </div>
    <template #footer>
      <div class="mr-auto text-sm text-on-surface-variant/65">
        {{ t("deviceLatency.effective", { value: currentLatency }) }}
      </div>
      <SButton variant="secondary" :loading="refreshing" @click="refresh">
        <template #icon><IconLucideRefreshCw /></template>
        {{ t("deviceLatency.refresh") }}
      </SButton>
    </template>
  </SDialog>
</template>
