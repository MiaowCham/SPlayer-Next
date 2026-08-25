import { getFftBinRange } from "@/services/audioFeatures";
import type { AppleMusicBackgroundAudio, AppleMusicBackgroundMotion } from "./types";

type FftFrame = readonly [number[], number[]];

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
const ranges = {
  bass: getFftBinRange(80, 300),
  mid: getFftBinRange(300, 900),
  high: getFftBinRange(900, 2000),
};

const getBandEnergy = (
  data: FftFrame,
  range: { start: number; end: number },
  gain: number,
): number => {
  if (range.start >= range.end) return 0;
  let sum = 0;
  let peak = 0;
  for (let index = range.start; index < range.end; index++) {
    const left = Number.isFinite(data[0][index]) ? data[0][index] : 0;
    const right = Number.isFinite(data[1][index]) ? data[1][index] : 0;
    const value = (left + right) * 0.5;
    sum += value * value;
    peak = Math.max(peak, value);
  }
  const rms = Math.sqrt(sum / (range.end - range.start));
  return clamp01((rms * 0.72 + peak * 0.28) * gain);
};

const approach = (current: number, target: number, elapsedMs: number, durationMs: number): number =>
  current + (target - current) * (1 - Math.exp(-elapsedMs / durationMs));

/** 创建带低频瞬态检测的频谱分析器。 */
export const createAppleMusicBackgroundAudioAnalyzer = () => {
  let fastBass = 0;
  let slowBass = 0;
  let mid = 0;
  let high = 0;
  let transient = 0;

  return {
    update(data: FftFrame, elapsedMs: number): AppleMusicBackgroundAudio {
      const elapsed = Math.min(100, Math.max(1, elapsedMs));
      const bassTarget = getBandEnergy(data, ranges.bass, 2.45);
      const midTarget = getBandEnergy(data, ranges.mid, 1.9);
      const highTarget = getBandEnergy(data, ranges.high, 1.65);

      fastBass = approach(fastBass, bassTarget, elapsed, bassTarget > fastBass ? 34 : 150);
      slowBass = approach(slowBass, bassTarget, elapsed, 520);
      mid = approach(mid, midTarget, elapsed, midTarget > mid ? 70 : 220);
      high = approach(high, highTarget, elapsed, highTarget > high ? 110 : 1000);

      const attack = clamp01((fastBass - slowBass) * 4.2);
      transient = approach(transient, attack, elapsed, attack > transient ? 36 : 260);

      return {
        bass: clamp01(fastBass),
        mid: clamp01(mid),
        high: clamp01(high),
        transient: clamp01(transient),
      };
    },
    reset(): AppleMusicBackgroundAudio {
      fastBass = 0;
      slowBass = 0;
      mid = 0;
      high = 0;
      transient = 0;
      return { bass: 0, mid: 0, high: 0, transient: 0 };
    },
  };
};

/** 创建渲染侧频谱过渡器，避免暂停恢复时低频形变突跳。 */
export const createAppleMusicBackgroundAudioSmoother = () => {
  let current = normalizeAppleMusicBackgroundAudio({});
  return {
    update(target: AppleMusicBackgroundAudio, elapsedMs: number): AppleMusicBackgroundAudio {
      const elapsed = Math.min(100, Math.max(1, elapsedMs));
      const smooth = (value: number, next: number): number => {
        const duration = next > value ? 180 : 360;
        return value + (next - value) * (1 - Math.exp(-elapsed / duration));
      };
      current = {
        bass: smooth(current.bass, target.bass),
        mid: smooth(current.mid, target.mid),
        high: smooth(current.high, target.high),
        transient: smooth(current.transient, target.transient),
      };
      return current;
    },
    reset(): AppleMusicBackgroundAudio {
      current = normalizeAppleMusicBackgroundAudio({});
      return current;
    },
  };
};

/** 规范化频谱输入，避免瞬时越界值污染着色器。 */
export const normalizeAppleMusicBackgroundAudio = (
  audio: Partial<AppleMusicBackgroundAudio>,
): AppleMusicBackgroundAudio => ({
  bass: clamp01(audio.bass ?? 0),
  mid: clamp01(audio.mid ?? 0),
  high: clamp01(audio.high ?? 0),
  transient: clamp01(audio.transient ?? 0),
});

/** 将频谱响应映射为背景动画参数。 */
export const getAppleMusicBackgroundMotion = (
  audio: AppleMusicBackgroundAudio,
  flowSpeed: number,
): AppleMusicBackgroundMotion => ({
  pulse: clamp01(audio.bass * 0.72 + audio.transient * 0.88),
  flow: Math.max(0, flowSpeed) * (1 + audio.bass * 0.003 + audio.mid * 0.0015),
  detail: clamp01(audio.high * 0.72 + audio.mid * 0.28),
  displacement: 0.035 + audio.bass * 0.035 + audio.transient * 0.045,
});
