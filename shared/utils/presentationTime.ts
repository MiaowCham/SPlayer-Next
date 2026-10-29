/**
 * 规范设备延迟为非负整数毫秒
 * @param value - 用户输入的延迟
 * @returns 有效延迟，非有限数视为零
 */
export const normalizeDeviceLatency = (value: number): number =>
  Number.isFinite(value) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(value))) : 0;

/**
 * 将源时间换算为声音实际到达设备时的歌词展示时间
 * @param position - 引擎源时间
 * @param lyricOffset - 当前歌曲的歌词偏移
 * @param deviceLatency - 设备输出延迟，按墙钟毫秒记录
 * @param speed - 当前播放倍率
 * @returns 不早于零的展示时间
 */
export const getPresentationTime = (
  position: number,
  lyricOffset: number,
  deviceLatency: number,
  speed = 1,
): number => Math.max(0, position + lyricOffset - normalizeDeviceLatency(deviceLatency) * speed);
