/** 滚轮和快捷键每次调整的滑块位置 */
export const VOLUME_STEP = 0.05;

/**
 * 滑块从满音量到最低位置的衰减跨度（dB）
 * 位置均匀摊到 0 ~ -60 dB，相邻两格相差 3 dB，半程约 -30 dB，
 * 最低档接近静音，配合位置 0 的静音档即可覆盖夜间小音量场景
 */
const MIN_VOLUME_DB = -60;

/**
 * 将数值限制到 0.0 ~ 1.0
 * @param value - 待限制的数值
 * @returns 限制后的数值
 */
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * 将滑块位置转换为线性增益，位置 0 为静音档
 * 除静音档外位置与 dB 严格线性，滑块变化量等于响度感知变化量
 * @param position - 滑块位置（0.0 ~ 1.0）
 * @returns 音频线性增益（0.0 ~ 1.0）
 */
export const volumePositionToGain = (position: number): number => {
  const value = clamp01(position);
  return value === 0 ? 0 : 10 ** ((MIN_VOLUME_DB * (1 - value)) / 20);
};

/**
 * 将线性增益转换为滑块位置，保证存档增益还原后仍是同一响度
 * @param gain - 音频线性增益（0.0 ~ 1.0）
 * @returns 滑块位置（0.0 ~ 1.0）
 */
export const volumeGainToPosition = (gain: number): number => {
  const value = clamp01(gain);
  if (value === 0) return 0;
  const position = clamp01(1 - (20 * Math.log10(value)) / MIN_VOLUME_DB);
  // 位置保留 6 位小数，避免浮点尾差让最低一档减一档后落在 0 与最低音量之间
  return Math.round(position * 1e6) / 1e6;
};
