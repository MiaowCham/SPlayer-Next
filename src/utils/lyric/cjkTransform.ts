/**
 * 歌词简繁中文转换（基于 OpenCC）
 */

import type { LyricLine } from "@shared/types/lyrics";
import type { CjkTransformMode } from "@shared/types/opencc";
import type { ChineseScriptPreference } from "@/types/settings";
import { isConfirmedChineseText } from "./language";

/**
 * 对歌词行数组应用 OpenCC 简繁转换
 * @param lines - 原始歌词行数组
 * @param preference - 中文字形偏好
 * @returns 转换后的歌词行数组（深拷贝结构）
 */
export const applyLyricCjkTransform = async (
  lines: LyricLine[],
  preference: ChineseScriptPreference,
): Promise<LyricLine[]> => {
  if (!lines || lines.length === 0 || preference === "default") {
    return lines;
  }

  if (typeof window === "undefined" || !window.api?.opencc?.convertBatch) {
    return lines;
  }

  const mode: CjkTransformMode = preference === "simplified" ? "t2s" : "s2t";

  // 收集所有可确认是中文的文本片段并记录位置。
  // 不转换 ruby、罗马音或日文/韩文行，避免破坏发音与其他语言中的汉字。
  const textsToConvert: string[] = [];
  const textPositions: Array<
    | { type: "translated"; lineIndex: number }
    | { type: "word"; lineIndex: number; wordIndex: number }
  > = [];

  for (let lIdx = 0; lIdx < lines.length; lIdx++) {
    const line = lines[lIdx];

    // 翻译没有独立语言元数据时，只处理含明确简体中文证据的内容。
    if (line.translatedLyric && isConfirmedChineseText(line.translatedLyric)) {
      textsToConvert.push(line.translatedLyric);
      textPositions.push({ type: "translated", lineIndex: lIdx });
    }

    // 正文只处理语言识别为中文的行。
    if (line.language === "zh-CN") {
      for (let wIdx = 0; wIdx < line.words.length; wIdx++) {
        const word = line.words[wIdx];
        if (word.word) {
          textsToConvert.push(word.word);
          textPositions.push({ type: "word", lineIndex: lIdx, wordIndex: wIdx });
        }
      }
    }
  }

  if (textsToConvert.length === 0) {
    return lines;
  }

  try {
    const convertedTexts = await window.api.opencc.convertBatch(textsToConvert, mode);

    // 深拷贝原始结构，避免直接突变可能导致的缓存污染
    const resultLines: LyricLine[] = lines.map((line) => ({
      ...line,
      words: line.words.map((word) => ({
        ...word,
        ruby: word.ruby?.map((ruby) => ({ ...ruby })),
      })),
    }));

    for (let i = 0; i < convertedTexts.length; i++) {
      const pos = textPositions[i];
      const converted = convertedTexts[i];

      if (pos.type === "translated") {
        resultLines[pos.lineIndex].translatedLyric = converted;
      } else {
        resultLines[pos.lineIndex].words[pos.wordIndex].word = converted;
      }
    }

    return resultLines;
  } catch (error) {
    console.error("[OpenCC] 歌词转换失败:", error);
    return lines;
  }
};
