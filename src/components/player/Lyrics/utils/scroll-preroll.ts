import type { LyricLine } from "@shared/types/lyrics";

const ADVANCE_NO_OVERLAP = 600;
const ADVANCE_OVERLAP = 400;
const OVERLAP_BOUNDARY_RATIO = 0.3;
const SCROLL_START_TIME = "__scrollStartTime";

type ScrollPrerollLine = LyricLine & { [SCROLL_START_TIME]?: number };

/** 读取行的滚动预滚时间；未设置时返回语义开始时间。 */
export const getScrollPrerollTime = (line: LyricLine): number =>
  (line as ScrollPrerollLine)[SCROLL_START_TIME] ?? line.startTime;

/**
 * 计算滚动预滚时间，但不修改歌词的语义开始时间。
 * @param sourceLines - 规范化后的歌词行数组
 * @returns 带滚动预滚元数据的克隆行数组
 */
export const applyScrollPreroll = (sourceLines: readonly LyricLine[]): LyricLine[] => {
  const lines: ScrollPrerollLine[] = sourceLines.map((line) => ({ ...line }));
  let previousStart = 0;
  let previousEnd = 0;
  let groupStart = 0;
  let groupEnd = 0;
  let hasPrevious = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.isBG) continue;
    const originalStart = line.startTime;
    const originalEnd = line.endTime;
    const hadGap = hasPrevious && originalStart >= previousEnd;
    const advance = !hasPrevious || hadGap ? ADVANCE_NO_OVERLAP : ADVANCE_OVERLAP;
    const boundary = !hasPrevious
      ? 0
      : hadGap
        ? groupEnd
        : previousStart + (previousEnd - previousStart) * OVERLAP_BOUNDARY_RATIO;
    line[SCROLL_START_TIME] = Math.max(boundary, originalStart - advance);

    const background = lines[index + 1];
    if (background?.isBG) background[SCROLL_START_TIME] = line[SCROLL_START_TIME];

    if (hasPrevious && originalStart < groupEnd && originalEnd > groupStart) {
      groupStart = Math.min(groupStart, originalStart);
      groupEnd = Math.max(groupEnd, originalEnd);
    } else {
      groupStart = originalStart;
      groupEnd = originalEnd;
    }
    previousStart = originalStart;
    previousEnd = originalEnd;
    hasPrevious = true;
  }
  return lines;
};
