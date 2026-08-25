import type { LyricLine } from "@shared/types/lyrics";

type AmlLyricLine = LyricLine & { __amllSkipWhitespaceSplit?: true };

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

/** 判断歌词行是否包含逐字时间。 */
export const hasWordTiming = (line: LyricLine): boolean => line.words.length > 1;

/** 判断逐行发音能否提升为主歌词。 */
export const canPromoteLinePronunciation = (line: LyricLine, force: boolean): boolean =>
  !!line.romanLyric.trim() && (force || (!hasWordRomanization(line) && !hasWordTiming(line)));

/** 判断是否需要把整首歌词交给渲染器按逐句模式处理。 */
export const shouldForceLinePronunciationMode = (lines: LyricLine[], enabled: boolean): boolean =>
  enabled && lines.some((line) => hasWordTiming(line) && canPromoteLinePronunciation(line, true));

/** AMLL 仅在整首不存在逐字发音时允许强制切换为逐句发音。 */
export const shouldForceAmlLinePronunciationMode = (
  lines: LyricLine[],
  enabled: boolean,
): boolean => !lines.some(hasWordRomanization) && shouldForceLinePronunciationMode(lines, enabled);

/** 将原文折叠为单个逐句词，确保混合歌词也不会触发整首逐字模式。 */
export const collapseToLineLyric = (line: LyricLine): LyricLine => {
  const text = line.words.map((word) => word.word).join("");
  return {
    ...line,
    isLineLyric: true,
    words: text
      ? [
          {
            word: text,
            startTime: line.startTime,
            endTime: line.endTime,
          },
        ]
      : [],
  };
};

/** 根据发音来源把默认渲染器歌词转换为对应的主歌词结构。 */
export const promoteDefaultPronunciation = (
  lines: LyricLine[],
  forceLinePronunciation: boolean,
): LyricLine[] => {
  if (shouldForceLinePronunciationMode(lines, forceLinePronunciation)) {
    return lines.map((line) =>
      canPromoteLinePronunciation(line, true)
        ? promotePronunciation(line, "line")
        : collapseToLineLyric(line),
    );
  }
  return lines.map((line) => {
    if (!hasWordTiming(line)) return promotePronunciation(line, "line");
    if (hasWordRomanization(line)) return promotePronunciation(line, "word");
    return line;
  });
};

/** AMLL 存在逐字发音时不再传递逐行音译，避免两种音译同时显示。 */
export const resolveAmlLineRomanization = (line: LyricLine, enabled: boolean): string =>
  enabled && !hasWordRomanization(line) ? line.romanLyric : "";

/** 给逐字发音音节补上分隔空格，保留源数据已有的尾随空白。 */
const spacedPronunciation = (value: string): string => (/\s$/.test(value) ? value : `${value} `);

const westernPunctuation: Record<string, string> = {
  "、": ",",
  "，": ",",
  "。": ".",
  "．": ".",
  "！": "!",
  "？": "?",
  "；": ";",
  "：": ":",
  "…": "...",
  "「": '"',
  "」": '"',
  "『": '"',
  "』": '"',
  "（": "(",
  "）": ")",
  "【": "[",
  "】": "]",
  ー: "-",
};

const symbolPattern = /[「」『』（）【】ー]/gu;

/** 把原文中的全角排版符号按西文习惯补入逐行发音。 */
const transferOriginalSymbols = (original: string, pronunciation: string): string => {
  let result = pronunciation.normalize("NFKC");
  const leading = original.match(/^[「『（【]+/u)?.[0] ?? "";
  const trailing = original.match(/[」』）】]+$/u)?.[0] ?? "";
  const prefix = [...leading].map((mark) => westernPunctuation[mark] ?? mark).join("");
  const suffix = [...trailing].map((mark) => westernPunctuation[mark] ?? mark).join("");
  if (prefix && !result.startsWith(prefix)) result = `${prefix}${result}`;
  if (suffix && !result.endsWith(suffix)) result = `${result}${suffix}`;

  const prolongedIndexes = [...original.matchAll(/ー/gu)].map((match) => match.index);
  if (prolongedIndexes.length === 0 || result.includes("-")) return result;
  const tokens = result.split(/(\s+)/u);
  for (const sourceIndex of prolongedIndexes) {
    const contentBefore = [...original.slice(0, sourceIndex).replace(symbolPattern, "")].length;
    let contentCount = 0;
    for (let index = 0; index < tokens.length; index += 2) {
      contentCount += 1;
      if (contentCount >= contentBefore) {
        tokens[index] = `${tokens[index]}-`;
        break;
      }
    }
  }
  return tokens.join("");
};

/** 忽略空白、标点和大小写后提取音节内的字母与数字。 */
const comparableSyllable = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

/** 判断发音是否只是原音节的等价文本。 */
const isSameSyllable = (original: string, pronunciation: string): boolean => {
  const normalizedOriginal = comparableSyllable(original);
  return !!normalizedOriginal && normalizedOriginal === comparableSyllable(pronunciation);
};

const normalizePunctuation = (value: string): string[] => {
  const normalized = value.replace(/…/g, "...");
  const punctuation = normalized.includes("...") ? ["..."] : [];
  return [
    ...punctuation,
    ...[...normalized.replace(/\.{3,}/g, "").matchAll(/[、，,。．.!！?？;；:：]/gu)].map(
      (match) => westernPunctuation[match[0]] ?? match[0],
    ),
  ];
};

/** 原文句末标点在发音和译文都缺失时，以西文形式补到发音中。 */
const appendMissingPunctuation = (
  original: string,
  pronunciation: string,
  translation: string,
): string => {
  const trailing = original.match(/[、，,。．.!！?？;；:：…]+$/u)?.[0] ?? "";
  if (!trailing) return pronunciation;
  const existing = new Set([
    ...normalizePunctuation(pronunciation),
    ...normalizePunctuation(translation),
  ]);
  const missing = normalizePunctuation(trailing).filter((mark) => !existing.has(mark));
  return `${pronunciation}${missing.join("")}`;
};

/**
 * 将发音提升为主歌词，返回独立副本，避免修改播放器持有的解析结果。
 * @param line - 原歌词行
 * @param mode - 逐行或逐字提升方式
 * @returns 无可用发音时返回原对象，否则返回转换后的副本
 */
export const promotePronunciation = (line: LyricLine, mode: "line" | "word"): LyricLine => {
  const originalText = line.words.map((word) => word.word).join("");
  if (!originalText) return line;

  if (mode === "word" && hasWordRomanization(line)) {
    const promoted: AmlLyricLine = {
      ...line,
      language: "und-Latn",
      __amllSkipWhitespaceSplit: true,
      words: line.words.map((word) => {
        const pronunciation = word.romanWord;
        if (!pronunciation?.trim()) return { ...word };
        const { ruby: _ruby, ...plainWord } = word;
        if (isSameSyllable(word.word, pronunciation)) {
          return {
            ...plainWord,
            romanWord: word.word,
          };
        }
        const displayedPronunciation = appendMissingPunctuation(
          word.word,
          pronunciation,
          line.translatedLyric,
        );
        return {
          ...plainWord,
          word: spacedPronunciation(displayedPronunciation),
          romanWord: word.word,
        };
      }),
      romanLyric: "",
    };
    return promoted;
  }

  const pronunciation = transferOriginalSymbols(originalText, resolveDefaultRomanization(line));
  if (!pronunciation) return line;
  return {
    ...line,
    language: "und-Latn",
    isLineLyric: true,
    words: [
      {
        word: pronunciation,
        startTime: line.startTime,
        endTime: line.endTime,
      },
    ],
    romanLyric: originalText,
  };
};
