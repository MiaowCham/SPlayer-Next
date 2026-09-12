import type { LyricLine } from "@shared/types/lyrics";

type Pinyin = (typeof import("pinyin-pro"))["pinyin"];

/**
 * 将普通话声调与分词方式归一化；不移除其他语言特有的变音符号。
 * @param value - 待比较的拼音
 * @returns 可比较的拼音字母；存在其他文字或粤拼 6–9 调时返回空串
 */
const normalizePinyin = (value: string): string => {
  const normalized = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/u:|v/gu, "ü")
    .normalize("NFD")
    .replace(/[\u0300\u0301\u0304\u030c]/gu, "")
    .normalize("NFC")
    .replace(/[\s\p{P}]/gu, "");
  if (!/^[a-zü0-5]+$/u.test(normalized) || /[0-5]{2}/u.test(normalized)) return "";
  return normalized.replace(/[0-5]/gu, "");
};

/**
 * 按原文每个汉字的普通话读音匹配，支持多音字及无空格连写，不枚举读音笛卡尔积。
 * @param original - 纯汉字正文，可含标点与空白
 * @param pronunciation - 对应发音
 * @param pinyin - 延迟加载的普通话字典接口
 * @param confirmedLine - 同句已有完整普通话匹配，允许去掉相同写法的单字发音
 * @returns 是否有足够依据把发音视为汉语拼音
 */
const isMandarinPinyin = (
  original: string,
  pronunciation: string,
  pinyin: Pinyin,
  confirmedLine = false,
): boolean => {
  const text = original.normalize("NFKC").replace(/[\s\p{P}]/gu, "");
  if (!text || !/^\p{Script=Han}+$/u.test(text)) return false;
  const candidate = normalizePinyin(pronunciation);
  if (!candidate) return false;
  const characters = [...text];
  const hasToneMark = /[\u0300\u0301\u0304\u030c]/u.test(pronunciation.normalize("NFD"));
  // 单字无调/数字写法可能与粤拼重合（如“都 dou1”），无法确认时保留。
  if (
    !confirmedLine &&
    !hasToneMark &&
    new Set(characters).size < 2 &&
    !/(?:zh|ch|sh|r|ao|iang|iong|uang|uai|ü)/u.test(candidate)
  )
    return false;
  let positions = new Set([0]);
  for (const character of characters) {
    const readings = pinyin(character, { type: "array", toneType: "none", multiple: true });
    const next = new Set<number>();
    for (const position of positions) {
      for (const reading of readings) {
        const syllable = normalizePinyin(reading);
        if (syllable && candidate.startsWith(syllable, position))
          next.add(position + syllable.length);
      }
    }
    if (!next.size) return false;
    positions = next;
  }
  return positions.has(candidate.length);
};

/**
 * 返回隐藏汉语拼音的展示副本，不改变原始发音、时间、译文或作者的歌词文件。
 * @param lines - 已完成语言判断的歌词
 * @returns 过滤后的展示歌词；关闭设置时应重新从原始内容解析
 */
export const hideChinesePronunciation = async (lines: LyricLine[]): Promise<LyricLine[]> => {
  if (
    !lines.some(
      (line) => line.romanLyric || line.words.some((word) => word.romanWord || word.ruby?.length),
    )
  )
    return lines;
  const { pinyin } = await import("pinyin-pro");
  return lines.map((line) => {
    if (
      line.language === "ja" ||
      line.language === "ko" ||
      line.language === "yue" ||
      line.language === "und-Latn"
    )
      return line;
    const original = line.words.map((word) => word.word).join("");
    const hideLine = isMandarinPinyin(original, line.romanLyric, pinyin);
    const joinedWords = line.words.map((word) => word.romanWord ?? "").join(" ");
    const confirmedLine = hideLine || isMandarinPinyin(original, joinedWords, pinyin);
    let changed = hideLine;
    const words = line.words.map((word) => {
      const hideWord =
        Boolean(word.romanWord) &&
        isMandarinPinyin(word.word, word.romanWord!, pinyin, confirmedLine);
      const hideRuby =
        Boolean(word.ruby?.length) &&
        isMandarinPinyin(
          word.word,
          word.ruby!.map((span) => span.word).join(" "),
          pinyin,
          confirmedLine,
        );
      if (!hideWord && !hideRuby) return word;
      changed = true;
      const result = { ...word };
      if (hideWord) delete result.romanWord;
      if (hideRuby) delete result.ruby;
      return result;
    });
    return changed ? { ...line, words, romanLyric: hideLine ? "" : line.romanLyric } : line;
  });
};
