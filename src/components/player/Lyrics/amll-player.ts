import { LyricPlayer } from "@applemusic-like-lyrics/core";

/** SPlayer 的 AMLL 时间线适配；升级时复核缓冲行与滚动锚点的保留规则。 */
export class SPlayerLyricPlayer extends LyricPlayer {
  /**
   * 重叠抬高模式下，首行结束便将滚动锚点交给仍在播放的首行。
   * core 默认等到下一行进入才清理缓冲，因此三行转两行时会保留旧锚点。
   */
  advanceOverlapAnchor(): void {
    const { bufferedGroups, hotGroups, scrollToIndex } = this.timelineState;
    if (hotGroups.size === 0 || hotGroups.has(scrollToIndex)) return;
    for (const index of bufferedGroups) {
      if (hotGroups.has(index)) continue;
      bufferedGroups.delete(index);
      this.currentLyricGroups[index]?.disable();
    }
    this.timelineState.scrollToIndex = Math.min(...hotGroups);
    void this.calcLayout();
  }

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
   * 只使用前两条主行计算对齐，后续同亮行不参与边界约束。
   * @returns 两行高度、间距和重叠时长；不足两行时返回 null
   */
  getBufferedMainLineMetrics(): {
    firstHeight: number;
    secondHeight: number;
    gap: number;
    overlapDuration: number;
  } | null {
    const indices = Array.from(this.timelineState.bufferedGroups)
      .filter((index) => {
        const line = this.currentLyricGroups[index]?.mainLine.getLine();
        return line && !line.isBG;
      })
      .sort((a, b) => a - b)
      .slice(0, 2);
    if (indices.length < 2) return null;
    const firstIndex = indices[0];
    const lastIndex = indices[indices.length - 1];
    // 与 core 的布局尺寸保持一致，不读取正在动画中的 DOM 坐标。
    const heights = this.currentLyricGroups
      .slice(firstIndex, lastIndex + 1)
      .map((group) => this.lyricGroupSize.get(group)?.[1] ?? this.size[1] / 5);
    const first = this.currentLyricGroups[firstIndex].mainLine.getLine();
    const second = this.currentLyricGroups[lastIndex].mainLine.getLine();
    return {
      firstHeight: heights[0],
      secondHeight: heights[heights.length - 1],
      gap: heights.slice(1, -1).reduce((sum, height) => sum + height, 0),
      overlapDuration:
        Math.min(first.endTime, second.endTime) - Math.max(first.startTime, second.startTime),
    };
  }
}
