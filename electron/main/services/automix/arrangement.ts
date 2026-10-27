import type { AutoMixEnvelope, AutoMixArrangement, AutoMixProfile } from "@shared/types/automix";
import type { AutoMixCandidate } from "./planner";

/**
 * 将对拍候选转换为按音乐时间错开的鼓、低频、人声与伴奏包络
 * @param plan - 已通过音频边界验证的交接计划
 * @param outgoing - 当前曲的尾部音乐证据
 * @param incoming - 下一曲的首部音乐证据
 * @returns 只含有限区间的可执行编排，不在音频回调做选点
 */
export const arrangeAutoMix = (
  plan: AutoMixCandidate,
  outgoing: AutoMixProfile,
  incoming: AutoMixProfile,
): AutoMixArrangement => {
  const duration = plan.durationMs;
  const beat = Math.max(outgoing.periodMs! / plan.outgoingRate, incoming.periodMs!);
  const bar = beat * 4;
  const gridEnd = (outgoing.gridEndMs! - plan.outStartMs) / plan.outgoingRate;
  const target = Math.min(Math.max(duration * 0.4, duration - bar * 2.5), gridEnd);
  const swaps = incoming.downbeats
    .map((time) => time - plan.inStartMs)
    .filter((time) => time >= beat && time <= Math.min(duration * 0.65, gridEnd));
  const drumAt = swaps.length
    ? swaps.reduce((best, time) =>
        Math.abs(time - target) < Math.abs(best - target) ? time : best,
      )
    : target;
  const bassAt = Math.min(duration * 0.8, drumAt + bar);
  const width = Math.min(400, beat / 2);
  const envelopes: AutoMixEnvelope[] = [
    { startMs: drumAt - width / 2, endMs: drumAt + width / 2 },
    { startMs: bassAt - width / 2, endMs: bassAt + width / 2 },
    { startMs: drumAt, endMs: Math.min(duration, drumAt + bar / 2) },
    { startMs: Math.max(0, drumAt - bar), endMs: duration },
    // 下一曲的鼓提前两小节对拍叠入，交换点不再是一瞬间的硬切
    { startMs: Math.max(0, drumAt - bar * 2), endMs: drumAt + width / 2 },
    { startMs: bassAt - width / 2, endMs: bassAt + width / 2 },
    {
      startMs: Math.min(duration - 200, drumAt + bar / 2),
      endMs: Math.min(duration, drumAt + bar / 2 + 300),
    },
    { startMs: 0, endMs: Math.min(duration, drumAt + bar) },
  ];
  // 调性差异较大时让鼓先融合，旋律与贝斯一起换手，避免整段伴奏持续冲突
  if (plan.strategy === "handoff") {
    const melody = {
      startMs: Math.max(0, bassAt - beat),
      endMs: Math.min(duration, bassAt + beat),
    };
    envelopes[3] = melody;
    envelopes[7] = melody;
  }
  return { ...plan, envelopes };
};
