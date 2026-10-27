import type { AutoMixPlan, AutoMixProfile } from "@shared/types/automix";
import { measureMixWindow } from "./features";

/** 分轨复核前的选点与速度候选，尚未生成可提交给引擎的声部包络 */
export type AutoMixCandidate = Omit<AutoMixPlan, "envelopes" | "stems">;

/**
 * 仅在用户使用正常速度和音调时允许 AutoMix
 * @param speed - 用户播放速度
 * @param pitch - 用户音调偏移
 * @returns 是否可以安排自动混音
 */
export const canAutoMix = (speed: number, pitch: number): boolean =>
  Math.abs(speed - 1) < 0.0001 && pitch === 0;

/**
 * 只在两曲拍速与重拍都可信时安排对拍乐句，无法对拍时由设置决定交叉过渡或直接切歌
 * @param outgoing - 当前曲尾部证据
 * @param incoming - 下一曲首部证据
 * @param currentEndMs - 当前曲目或 CUE 的有效终点
 * @returns 待分轨复核的对拍候选，无法对拍时为空
 */
export const planAutoMix = (
  outgoing: AutoMixProfile,
  incoming: AutoMixProfile,
  currentEndMs: number,
): AutoMixCandidate | null => {
  const endMs = Math.min(currentEndMs, outgoing.lastAudibleMs + 200, outgoing.endMs);
  const entry = Math.max(incoming.startMs, incoming.firstAudibleMs - 100);
  const bodyEnd = Math.min(endMs, outgoing.bodyEndMs + 300);
  let selected: AutoMixCandidate | null = null;
  if (
    outgoing.periodMs &&
    incoming.periodMs &&
    outgoing.stability >= 0.85 &&
    incoming.stability >= 0.85 &&
    outgoing.gridStartMs != null &&
    outgoing.gridEndMs != null &&
    incoming.gridStartMs != null &&
    incoming.gridEndMs != null
  ) {
    const rates = [0.5, 1, 2].map((fold) => (outgoing.periodMs! / incoming.periodMs!) * fold);
    const rate = rates.sort((a, b) => Math.abs(Math.log(a)) - Math.abs(Math.log(b)))[0];
    const commonBeat = Math.max(outgoing.periodMs / rate, incoming.periodMs);
    const bar = commonBeat * 4;
    const downbeats = [outgoing, incoming].map((profile) => {
      const times = profile.downbeats.filter(
        (time) => time >= profile.gridStartMs! && time <= profile.gridEndMs!,
      );
      const barMs = profile.periodMs! * 4;
      // 相邻两个小节提供局部支持，不让远处的重拍相位变化或零散误检否定当前乐句
      return times.filter((time) => {
        const neighbors = new Set<number>();
        for (const other of times) {
          const offset = Math.round((other - time) / barMs);
          if (
            offset !== 0 &&
            Math.abs(offset) <= 2 &&
            Math.abs(other - time - offset * barMs) <= Math.max(40, profile.periodMs! * 0.06)
          )
            neighbors.add(offset);
        }
        return neighbors.size >= 2;
      });
    });
    const anchor = downbeats[1].find((time) => time >= Math.max(entry, incoming.gridStartMs!));
    if (Math.abs(rate - 1) <= 0.08 + 1e-9 && anchor != null) {
      const outgoingLevel = measureMixWindow(outgoing, outgoing.startMs, bodyEnd).level;
      const incomingLevel = measureMixWindow(incoming, entry, incoming.endMs).level;
      // 对拍路径沿用原有入口优先级，原速融合另行选择小节入口
      const syncedEntry = anchor > entry + bar ? anchor : entry;
      // 原有入口优先，无法成句时再从首个可靠小节入场
      for (const cue of new Set([syncedEntry, anchor])) {
        if (selected) continue;
        let bestScore = Infinity;
        for (const bars of [8, 4, 2]) {
          const phraseLength = bars * bar;
          if (
            phraseLength > 18_000 ||
            phraseLength < 3500 ||
            cue + phraseLength > incoming.endMs - 300
          )
            continue;
          if (cue + phraseLength > incoming.gridEndMs + commonBeat) continue;
          for (const beat of downbeats[0]) {
            const start = beat - (anchor - cue) * rate;
            const length = Math.min(phraseLength, (endMs - start) / rate);
            const finish = start + length * rate;
            if (start < outgoing.startMs + 200 || beat < outgoing.gridStartMs) continue;
            if (phraseLength - length > 20 || length < 3500) continue;
            // 先交出鼓，再让自由速度的尾奏自然退出
            const gridRequired = start + bar * rate;
            if (gridRequired > outgoing.gridEndMs + outgoing.periodMs) continue;
            if (finish < bodyEnd - outgoing.periodMs * 2 || finish < currentEndMs - 16_000)
              continue;
            const a = measureMixWindow(outgoing, start, finish);
            const b = measureMixWindow(incoming, cue, cue + length);
            const hasTone = Math.hypot(...a.chroma) > 0 && Math.hypot(...b.chroma) > 0;
            const affinity = hasTone
              ? a.chroma.reduce((sum, value, i) => sum + value * b.chroma[i], 0)
              : 0.75;
            const preferred = affinity >= 0.7 ? 16_000 : 8000;
            const energyCost =
              Math.max(0, Math.log(outgoingLevel / a.level)) +
              Math.max(0, Math.log(incomingLevel / b.level));
            const boundaryCost = outgoing.boundaries.length
              ? Math.min(
                  ...outgoing.boundaries.map((time) =>
                    Math.abs(time - (start + (length * rate) / 2)),
                  ),
                ) / bar
              : 0;
            const score =
              Math.abs(length - preferred) / preferred +
              (Math.abs(finish - bodyEnd) / bar) * 0.2 +
              energyCost * 0.4 +
              Math.abs(Math.log(a.level / b.level)) * 0.1 +
              Math.min(2, boundaryCost) * 0.1 +
              ((1 - affinity) * length) / 8000;
            if (score >= bestScore) continue;
            bestScore = score;
            selected = {
              outStartMs: start,
              inStartMs: cue,
              durationMs: length,
              outgoingRate: rate,
              levelRatio: 1,
              strategy: affinity >= 0.7 ? "phrase" : "handoff",
            };
          }
        }
      }
    }
  }
  return selected;
};
