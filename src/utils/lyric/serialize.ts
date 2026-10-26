import type { LyricInput, LyricFormat, LyricLine } from "@shared/types/lyrics";
import type { DownloadLyricFormat } from "@shared/types/download";
import { parseLyric as parseKitLyric, toEnhancedLRC, toLRC, toTTML } from "lyric-kit";
import { parseLyric } from "./parse";

/**
 * 将歌词转换为下载格式，保留辅助行、逐字时间和原始 TTML 元数据
 * @param input - 原始歌词载荷
 * @param mainFormat - 原始格式，包含本分支扩展格式
 * @param target - 下载格式
 * @returns 歌词文本，无有效内容时返回 null
 */
export const buildDownloadLyric = (
  input: LyricInput,
  mainFormat: LyricFormat,
  target: DownloadLyricFormat | "ttml",
): string | null => {
  if (!input.content.trim()) return null;
  let lines: LyricLine[];
  try {
    lines =
      mainFormat === "ttmlLine" ||
      mainFormat === "lrcn" ||
      mainFormat === "lnt" ||
      mainFormat === "lqe" ||
      input.translationFormat === "lnt" ||
      input.translationFormat === "lrcn" ||
      input.romajiFormat === "lnt" ||
      input.romajiFormat === "lrcn"
        ? parseLyric(input, mainFormat)
        : parseKitLyric({ ...input, format: mainFormat } as Parameters<typeof parseKitLyric>[0])
            .lines;
  } catch {
    return null;
  }
  if (!lines.length) return null;
  if (target === "ttml")
    return mainFormat === "ttml" || mainFormat === "ttmlLine"
      ? input.content.trim()
      : toTTML(lines);
  const content =
    target === "enhanced-lrc"
      ? toEnhancedLRC(lines, { roundTrip: true })
      : toLRC(lines, { roundTrip: true });
  return content.trim() ? content : null;
};
