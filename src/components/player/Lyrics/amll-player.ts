import { LyricPlayer } from "@applemusic-like-lyrics/core";

/** SPlayer 的 AMLL 时间线适配，升级时复核快照和高度测量协议 */
export class SPlayerLyricPlayer extends LyricPlayer {
  /**
   * 设置首行结束时的重叠锚点交接规则
   * @param enabled - 是否启用重叠抬高
   */
  advanceOverlapAnchor(enabled = true): void {
    if (this.timelineController.__amllAdvanceOverlapAnchor === enabled) return;
    this.timelineController.__amllAdvanceOverlapAnchor = enabled;
    this.setCurrentTime(this.getCurrentTime(), true);
  }

  /** 返回当前布局保留的主高亮行数 */
  getBufferedMainLineCount(): number {
    let count = 0;
    for (const index of this.timelineController.getSnapshot().highlightedGroups) {
      if (!this.currentLyricGroups[index]?.mainLine.getLine().isBG) count++;
    }
    return count;
  }

  /** 返回前两条主高亮行的高度、间距和重叠时长 */
  getBufferedMainLineMetrics(): {
    firstHeight: number;
    secondHeight: number;
    gap: number;
    overlapDuration: number;
  } | null {
    const indices = Array.from(this.timelineController.getSnapshot().highlightedGroups)
      .filter((index) => !this.currentLyricGroups[index]?.mainLine.getLine().isBG)
      .sort((a, b) => a - b)
      .slice(0, 2);
    if (indices.length < 2) return null;
    const [firstIndex, secondIndex] = indices;
    const first = this.currentLyricGroups[firstIndex].mainLine.getLine();
    const second = this.currentLyricGroups[secondIndex].mainLine.getLine();
    let gap = 0;
    for (let index = firstIndex + 1; index < secondIndex; index++) gap += this.getLineHeight(index);
    return {
      firstHeight: this.getLineHeight(firstIndex),
      secondHeight: this.getLineHeight(secondIndex),
      gap,
      overlapDuration:
        Math.min(first.endTime, second.endTime) - Math.max(first.startTime, second.startTime),
    };
  }
}
