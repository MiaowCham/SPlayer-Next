import type { LyricLine } from "@shared/types/lyrics";

/**
 * 将当前版本的解析歌词转换为快捷复制文本，时间轴始终使用原始行时间
 * @param lines - 当前版本歌词行
 * @param translation - 是否附带翻译
 * @param timestamps - 是否使用 LRC 行时间戳
 * @returns 可直接粘贴的正文
 */
export const buildClipboardLyric = (
  lines: LyricLine[],
  translation: boolean,
  timestamps: boolean,
): string =>
  lines
    .flatMap((line) => {
      const text = line.words.map((word) => word.word).join("");
      if (!text.trim()) return [];
      const time = Math.max(0, Math.trunc(line.startTime));
      const stamp = timestamps
        ? `[${String(Math.floor(time / 60000)).padStart(2, "0")}:${String(Math.floor(time / 1000) % 60).padStart(2, "0")}.${String(time % 1000).padStart(3, "0")}]`
        : "";
      return [
        stamp + text,
        ...(translation && line.translatedLyric ? [stamp + line.translatedLyric] : []),
      ];
    })
    .join("\n");
