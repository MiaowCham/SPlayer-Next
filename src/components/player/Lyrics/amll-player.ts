import { LyricPlayer } from "@applemusic-like-lyrics/core";

/** SPlayer 的 AMLL 时间线适配；升级时复核缓冲行与滚动锚点的保留规则。 */
export class SPlayerLyricPlayer extends LyricPlayer {
  /**
   * 返回布局仍保留为高亮的主行数，而非仅统计尚未结束的时间区间。
   * 0.5.2 会把已结束行留在 bufferedGroups，直到后续行进入或整组结束才切换锚点。
   * @returns 当前布局中的主高亮行数，不包含背景行
   */
  getBufferedMainLineCount(): number {
    let count = 0;
    for (const index of this.timelineState.bufferedGroups) {
      const line = this.currentLyricGroups[index]?.mainLine.getLine();
      if (line && !line.isBG) count++;
    }
    return count;
  }

  /**
   * 获取前两条重叠主歌词的布局数据。
   * @returns 两行高度、间距和重叠时长；不足两行时返回 null
   */
  getBufferedMainLineMetrics(): {
    firstHeight: number;
    secondHeight: number;
    gap: number;
    overlapDuration: number;
  } | null {
    const lines = Array.from(this.timelineState.bufferedGroups)
      .map((index) => this.currentLyricGroups[index]?.mainLine)
      .filter((line) => line && !line.getLine().isBG)
      .slice(0, 2);
    if (lines.length < 2) return null;
    const first = lines[0];
    const second = lines[1];
    const firstLine = first.getLine();
    const secondLine = second.getLine();
    const firstElement = first.getElement();
    const secondElement = second.getElement();
    const firstHeight = firstElement?.getBoundingClientRect().height ?? 0;
    const secondHeight = secondElement?.getBoundingClientRect().height ?? 0;
    const gap =
      Math.max(0, secondElement?.getBoundingClientRect().top ?? 0) -
      Math.max(0, firstElement?.getBoundingClientRect().bottom ?? 0);
    return {
      firstHeight,
      secondHeight,
      gap,
      overlapDuration:
        Math.min(firstLine.endTime, secondLine.endTime) -
        Math.max(firstLine.startTime, secondLine.startTime),
    };
  }
}
