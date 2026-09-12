const MIN_OVERLAP_DURATION_MS = 500;

/**
 * 根据前后两行的实际高度计算重叠时的对齐位置。
 * @param alignPosition - 用户设置的默认对齐位置
 * @param containerHeight - 歌词容器高度
 * @param firstHeight - 第一行高度
 * @param secondHeight - 第二行高度
 * @param gap - 两行中心之间的额外间距
 * @param overlapDuration - 两行重叠时长
 * @returns 应用后的对齐位置
 */
export const getOverlapAlignPosition = (
  alignPosition: number,
  containerHeight: number,
  firstHeight: number,
  secondHeight: number,
  gap: number,
  overlapDuration: number,
): number => {
  if (
    containerHeight <= 0 ||
    overlapDuration < MIN_OVERLAP_DURATION_MS ||
    firstHeight <= 0 ||
    secondHeight <= 0
  ) {
    return alignPosition;
  }

  const separation = (firstHeight + secondHeight) / 2 + gap;
  const desiredFirstCenter = alignPosition * containerHeight - separation;
  const minFirstCenter = firstHeight / 2;
  const maxFirstCenter = containerHeight - secondHeight / 2 - separation;
  const firstCenter = Math.min(Math.max(desiredFirstCenter, minFirstCenter), maxFirstCenter);
  return firstCenter / containerHeight;
};
