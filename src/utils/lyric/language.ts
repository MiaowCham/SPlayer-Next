import type { LyricLine } from "@shared/types/lyrics";

/** 日语假名：平假名 + 片假名 + 半角假名 + 促音/长音符号 */
const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}\u30FC\uFF66-\uFF9F]/u;

/** 韩文：谚文音节 + 谚文字母 + 谚文兼容字母 */
const HANGUL_RE = /[\p{Script=Hangul}\u3130-\u318F]/u;

/** 中日韩统一表意文字（含扩展 A 区） */
const HAN_RE = /\p{Script=Han}/u;

/** 拉丁字母；数字与标点不能作为英文判断依据 */
const LATIN_RE = /\p{Script=Latin}/u;

/**
 * 只在文本包含现代简体中文特有字形时判定为中文。
 *
 * 纯汉字无法可靠区分中文与日文，例如“爱”与“愛”可能分别出现在两种语言中；
 * 为避免转换日文汉字，这里宁可漏判繁体中文，也不把没有明确证据的文本交给 OpenCC。
 */
const CHINESE_GLYPH_EVIDENCE_RE = /[这這们們说說话语让讓还還听聽欢歡爱为為发發吗嗎汉龙书车]/u;
const CHINESE_WORD_EVIDENCE_RE =
  /(?:你|妳|您|我们|我們|你们|你們|他们|他們|她们|她們|没有|沒有|不会|不會|因为|因為|所以)/u;

/**
 * 判断文本是否有足够证据可安全视为中文。
 * @param text - 待判断的歌词或翻译文本
 */
export const isConfirmedChineseText = (text: string): boolean =>
  !KANA_RE.test(text) &&
  !HANGUL_RE.test(text) &&
  (CHINESE_GLYPH_EVIDENCE_RE.test(text) || CHINESE_WORD_EVIDENCE_RE.test(text));

/**
 * 为歌词行补充语言信息
 *
 * 已由解析器标注的语言始终优先。未标注行中，含假名或谚文的整首歌词会把纯汉字行
 * 视为相应语言；仅有明确简体中文证据的纯汉字行才标为中文，其余保留为 und-Hani。
 * 这会放弃转换部分全繁体中文，但避免误改没有假名的日文汉字歌词。
 *
 * @param lines - 已解析的整首歌词
 */
export const applyLyricLanguages = (lines: LyricLine[]): void => {
  const lineContents = lines.map((line) => line.words.map((word) => word.word).join(""));

  let hasKana = false;
  let hasHangul = false;
  for (const content of lineContents) {
    if (KANA_RE.test(content)) hasKana = true;
    if (HANGUL_RE.test(content)) hasHangul = true;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const content = lineContents[i];
    // 解析器提供的 BCP 47 语言标签比脚本启发式更可靠。
    if (line.language) continue;

    if (KANA_RE.test(content)) {
      line.language = "ja";
    } else if (HANGUL_RE.test(content)) {
      line.language = "ko";
    } else if (HAN_RE.test(content)) {
      if (hasKana) {
        line.language = "ja";
      } else if (hasHangul) {
        line.language = "ko";
      } else if (isConfirmedChineseText(content)) {
        line.language = "zh-CN";
      } else {
        line.language = "und-Hani";
      }
    } else if (LATIN_RE.test(content)) {
      line.language = "und-Latn";
    } else {
      delete line.language;
    }
  }
};
