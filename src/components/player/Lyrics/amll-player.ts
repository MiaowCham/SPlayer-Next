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
}
