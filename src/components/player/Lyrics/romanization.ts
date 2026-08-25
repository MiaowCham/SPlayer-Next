import type { LyricLine } from "@shared/types/lyrics";

/** 默认渲染器优先使用逐行音译，缺失时才由逐字发音拼接。 */
export const resolveDefaultRomanization = (line: LyricLine): string => {
  if (line.romanLyric.trim()) return line.romanLyric;
  return line.words
    .map((word) => word.romanWord?.trim().replace(/\s+/g, " "))
    .filter((word): word is string => !!word)
    .join(" ");
};

/** 判断行内是否包含可供 AMLL 单词渲染的逐字发音。 */
export const hasWordRomanization = (line: LyricLine): boolean =>
  line.words.some((word) => !!word.romanWord?.trim());

/** AMLL 存在逐字发音时不再传递逐行音译，避免两种音译同时显示。 */
export const resolveAmlLineRomanization = (line: LyricLine, enabled: boolean): string =>
  enabled && !hasWordRomanization(line) ? line.romanLyric : "";
