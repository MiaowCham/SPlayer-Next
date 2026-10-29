import { useSettingsStore } from "@/stores/settings";
import { normalizeDeviceLatency } from "@shared/utils/presentationTime";

/**
 * 获取设备独立延迟，未配置时继承默认值
 * @param deviceId - 当前设备标识，null 表示尚无有效设备
 * @returns 延迟毫秒数
 */
export const getDeviceLatency = (deviceId: string | null): number => {
  const settings = useSettingsStore().player;
  const record =
    deviceId && Object.hasOwn(settings.deviceLatencies, deviceId)
      ? settings.deviceLatencies[deviceId]
      : undefined;
  return normalizeDeviceLatency(record?.latencyMs ?? settings.deviceLatencyDefault);
};

/**
 * 保存或删除设备独立延迟，只保留最近配置的三十个设备
 * @param deviceId - 设备稳定标识
 * @param latencyMs - 独立延迟，null 表示恢复默认
 */
export const setDeviceLatencyOverride = (deviceId: string, latencyMs: number | null): void => {
  const settings = useSettingsStore().player;
  const records = { ...settings.deviceLatencies };
  if (latencyMs === null) delete records[deviceId];
  else records[deviceId] = { latencyMs: normalizeDeviceLatency(latencyMs), updatedAt: Date.now() };
  settings.deviceLatencies = Object.fromEntries(
    Object.entries(records)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, 30),
  );
};
