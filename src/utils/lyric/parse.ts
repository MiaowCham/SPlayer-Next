import type { LyricFormat, LyricInput, LyricLine } from "@shared/types/lyrics";
import { DEFAULT_LYRIC_FORMAT_ORDER } from "@shared/types/lyrics";
import { parseLRC } from "./parseLRC";
import { parseQRC } from "./parseQRC";
import { parseYRC } from "./parseYRC";
import { parseKRC } from "./parseKRC";
import { parseTTML } from "./parseTTML";
import { parseLyS } from "./parseLyS";
import { parseLQEInput } from "./parseLQE";
import { parseSRT } from "./parseSRT";
import { parseASS } from "./parseASS";
import { parseLNT, parseLRCN } from "./parseLRCN";
import { normalizeKangxi } from "./kangxi";
import { pickTranslationIndex } from "./translationLanguage";

export interface ParseLyricOptions {
  detectBackground?: boolean;
  platform?: import("@shared/types/platform").Platform;
  fallbackTranslation?: boolean;
  /** 是否将康熙部首等非标准汉字还原为标准汉字 */
  normalizeNonStandardHan?: boolean;
}

/**
 * 从外部歌词列表中选出最优格式的索引
 * @param lyrics   外部歌词列表
 * @param priority 自定义格式优先级
 * @returns 最优格式的索引，无可用歌词时返回 -1
 */
export const bestExternalIndex = (
  lyrics: { format: LyricFormat }[],
  priority?: readonly LyricFormat[],
): number => {
  if (lyrics.length === 0) return -1;
  const order = priority && priority.length > 0 ? priority : DEFAULT_LYRIC_FORMAT_ORDER;
  let bestIdx = 0;
  let bestPriority = order.length;
  for (let i = 0; i < lyrics.length; i++) {
    const p = order.indexOf(lyrics[i].format);
    const rank = p === -1 ? order.length : p;
    if (rank < bestPriority) {
      bestPriority = rank;
      bestIdx = i;
    }
  }
  return bestIdx;
};

/**
 * 根据内容特征检测歌词格式
 * 用于内嵌歌词等无扩展名的场景
 * @param text 歌词文本内容
 * @returns 检测到的格式，默认 "lrc"
 */
export const detectFormat = (text: string): LyricFormat => {
  const trimmed = text.trimStart();
  if (/^\[Lyricify Quick Export\]$/im.test(text)) return "lqe";
  // Lyrics Next / LRCN Trans 必须在 LRC 兜底前识别
  if (/^\[(?:translate|transliteration):\s*format@(?:lrcn\s*trans|lnt)\]/im.test(text)) {
    return "lnt";
  }
  if (/^\[Lyrics Next\]$/im.test(text) || /^\[(?:version:2\.\d+|timing:)/im.test(text)) {
    return "lrcn";
  }
  // ASS
  if (trimmed.startsWith("[Script Info]") || /^\[V4\+? Styles\]/m.test(text)) return "ass";
  // SRT：序号 + 时间行
  if (/^\d+\r?\n\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(trimmed)) return "srt";
  // TTML / QRC XML
  if (trimmed.startsWith("<?xml") || trimmed.startsWith("<")) {
    if (/LyricContent="|<QrcInfos|<Lyric_/.test(text)) return "qrc";
    if (trimmed.startsWith("<tt") || /<tt\s/i.test(text)) {
      // 没有带时间的 span 时是逐行 TTML，仍复用 TTML 解析器但独立参与格式排序。
      return /<span\b[^>]*(?:begin|end)\s*=/i.test(text) ? "ttml" : "ttmlLine";
    }
  }
  // YRC：[起始,时长](起始,时长,0)
  if (/\[\d+,\d+\]\(\d+,\d+,\d+\)/.test(text)) return "yrc";
  // QRC 纯文本：[起始,时长]文字(起始,时长)
  if (/\[\d+,\d+\][^[\n]+\(\d+,\d+\)/.test(text)) return "qrc";
  // LyS：[属性码]文字(起始,时长)
  if (/^\[\d\][^[\]]+\(\d+,\d+\)/m.test(text)) return "lys";
  // 兜底 LRC
  return "lrc";
};

/**
 * 根据格式类型解析歌词文本
 * @param text 歌词文本内容
 * @param format 歌词格式
 * @param preferredLang 偏好翻译语言标签
 * @returns 解析后的歌词行数组
 */
const parseContent = (
  text: string,
  format: LyricFormat,
  preferredLang = "",
  options: ParseLyricOptions = {},
): LyricLine[] => {
  const detectBackground = options.detectBackground !== false;
  switch (format) {
    case "ttml":
    case "ttmlLine":
      return parseTTML(text, preferredLang, options.fallbackTranslation);
    case "qrc":
      return parseQRC(text, detectBackground);
    case "krc":
      return parseKRC(text, detectBackground);
    case "yrc":
      return parseYRC(text, detectBackground);
    case "lrc":
      return parseLRC(text, detectBackground);
    case "lrcn":
      return parseLRCN(text, options.platform).lines;
    case "lnt":
      return [];
    case "lys":
      return parseLyS(text);
    case "lqe":
      return [];
    case "srt":
      return parseSRT(text);
    case "ass":
      return parseASS(text);
  }
};

/**
 * 解析歌词
 * @param input 主 + 可选翻译 / 音译
 * @param format 主歌词格式
 * @param preferredLang 偏好翻译语言标签
 * @param options 解析选项
 */
export const parseLyric = (
  input: LyricInput,
  format: LyricFormat,
  preferredLang = "",
  options: ParseLyricOptions = {},
): LyricLine[] => {
  // 非标准汉字还原默认开启，可由设置关闭
  const normalizeHan =
    options.normalizeNonStandardHan === false ? (text: string): string => text : normalizeKangxi;
  const content = normalizeHan(input.content);
  if (format === "lqe") return parseLyric(parseLQEInput(content), "lys", preferredLang, options);
  const embedded =
    format === "lrcn"
      ? splitEmbeddedLrcn(content, preferredLang, options.fallbackTranslation)
      : null;
  const mainContent = embedded?.content ?? content;
  const parsedLrcn = format === "lrcn" ? parseLRCN(mainContent, options.platform) : null;
  const lines = parsedLrcn?.lines ?? parseContent(content, format, preferredLang, options);
  const translation = input.translation ?? embedded?.translation;
  const translationFormat = input.translationFormat ?? embedded?.translationFormat;
  if (translation && translationFormat) {
    if (translationFormat === "lnt" && parsedLrcn) {
      pairLNT(
        lines,
        parsedLrcn.lineIds,
        parseLNT(normalizeHan(translation)),
        "translatedLyric",
        parsedLrcn.offset,
      );
    } else {
      pairTranslation(
        lines,
        parseContent(normalizeHan(translation), translationFormat, "", options),
        "translatedLyric",
      );
    }
  }
  const externalWordRomaji = input.romajiFormat === "lnt" ? input.romaji : undefined;
  const romaji =
    input.romajiFormat === "lnt" ? embedded?.romaji : (input.romaji ?? embedded?.romaji);
  const romajiFormat =
    input.romajiFormat === "lnt"
      ? embedded?.romajiFormat
      : (input.romajiFormat ?? embedded?.romajiFormat);
  if (romaji && romajiFormat) {
    if (romajiFormat !== "lnt") {
      const romajiLines =
        format === "lrcn" && romajiFormat === "lrc"
          ? parseLRCN(normalizeHan(romaji), options.platform).lines
          : parseContent(normalizeHan(romaji), romajiFormat, "", options);
      pairTranslation(lines, romajiLines, "romanLyric");
    }
  }
  const wordRomaji = externalWordRomaji ?? embedded?.wordRomaji;
  if (wordRomaji && parsedLrcn) {
    pairLNT(
      lines,
      parsedLrcn.lineIds,
      parseLNT(normalizeHan(wordRomaji)),
      "romanLyric",
      parsedLrcn.offset,
    );
  }
  removeDuplicateRomanization(lines);
  return lines;
};

/**
 * 规范用于整行音译比较的文本，忽略大小写、空白和标点差异。
 * @param text - 待比较文本
 * @returns 规范化后的整行文本
 */
const comparableLineText = (text: string): string => text.toLowerCase().replace(/[\s\p{P}]+/gu, "");

/** 主歌词与对应的整行音译内容一致时，分别移除逐行或逐字音译。 */
const removeDuplicateRomanization = (lines: LyricLine[]): void => {
  for (const line of lines) {
    const main = comparableLineText(lineText(line));
    if (!main) continue;
    const lineRoman = comparableLineText(line.romanLyric);
    const wordRoman = comparableLineText(line.words.map((word) => word.romanWord ?? "").join(""));
    if (lineRoman === main) line.romanLyric = "";
    if (wordRoman === main) {
      for (const word of line.words) delete word.romanWord;
    }
  }
};

/** 从 LRCN 内嵌的多歌词分段中提取主歌词、翻译和音译。 */
const splitEmbeddedLrcn = (
  text: string,
  preferredLang: string,
  fallbackTranslation = true,
): {
  content: string;
  translation?: string;
  translationFormat?: LyricFormat;
  romaji?: string;
  romajiFormat?: LyricFormat;
  wordRomaji?: string;
} | null => {
  const marker = /^\[(lyrics|translate|transliteration):\s*format@([^\]]+)\]\s*$/gim;
  const markers = [...text.matchAll(new RegExp(marker.source, marker.flags))];
  if (markers.length === 0) return null;
  const header = text.slice(0, markers[0].index);
  const result: {
    content: string;
    translation?: string;
    translationFormat?: LyricFormat;
    romaji?: string;
    romajiFormat?: LyricFormat;
    wordRomaji?: string;
  } = { content: "" };
  const translations: { content: string; format: LyricFormat; lang: string | null }[] = [];
  for (let index = 0; index < markers.length; index++) {
    const match = markers[index];
    const body = text.slice(match.index! + match[0].length, markers[index + 1]?.index).trim();
    const value = match[2].toLowerCase();
    const parsedFormat: LyricFormat = /lrcn\s*trans|\blnt\b/.test(value)
      ? "lnt"
      : /lyrics\s*next|\blrcn\b/.test(value)
        ? "lrcn"
        : "lrc";
    if (match[1].toLowerCase() === "lyrics") result.content = `${header}${body}`;
    else if (match[1].toLowerCase() === "translate") {
      const lang = /^\s*\[lang:\s*([^\]]+)\]\s*$/im.exec(body)?.[1] ?? null;
      translations.push({ content: body, format: parsedFormat, lang });
    } else {
      if (parsedFormat === "lnt") {
        result.wordRomaji = body;
      } else {
        result.romaji = body;
        result.romajiFormat = parsedFormat;
      }
    }
  }
  const translationIndex = pickTranslationIndex(translations, preferredLang, fallbackTranslation);
  if (translationIndex !== -1) {
    const translation = translations[translationIndex];
    result.translation = translation.content;
    result.translationFormat = translation.format;
  }
  return result.content ? result : null;
};

/** 按 LRCN 行 ID 配对 LRCN Trans，背景行以紧随主行的规则关联。 */
const pairLNT = (
  lines: LyricLine[],
  lineIds: Map<LyricLine, string>,
  transLines: ReturnType<typeof parseLNT>,
  field: "translatedLyric" | "romanLyric",
  offset = 0,
): void => {
  let previous: LyricLine | null = null;
  const usedTargets = new Set<LyricLine>();
  for (const trans of transLines) {
    let target: LyricLine | undefined;
    if (trans.isBG) {
      const mainIndex = previous ? lines.indexOf(previous) : -1;
      const attached = mainIndex >= 0 ? lines[mainIndex + 1] : undefined;
      target = attached?.isBG && !usedTargets.has(attached) ? attached : undefined;
    } else if (trans.id) {
      target = lines.find(
        (line) => lineIds.get(line) === trans.id && !line.isBG && !usedTargets.has(line),
      );
      previous = target ?? null;
    }
    if (!target || !isMeaningfulTrans(trans.text)) continue;
    usedTargets.add(target);
    if (field === "translatedLyric" || !trans.hasTimedWords) target[field] = trans.text;
    if (field === "romanLyric" && trans.hasTimedWords) {
      completeLntWordTimes(trans.words, target, offset, trans.startTime);
      alignLntRomanWords(target.words, trans.words, offset);
    }
  }
};

/** 按目标主行补齐 LNT 中省略的首词起点和末词终点。 */
const completeLntWordTimes = (
  words: LyricLine["words"],
  target: LyricLine,
  offset: number,
  declaredStart?: number,
): void => {
  if (words.length === 0) return;
  const rawStart = Math.max(0, target.startTime - offset);
  const rawEnd = Math.max(rawStart, target.endTime - offset);
  const first = words[0];
  if (first.startTime === 0) first.startTime = declaredStart ?? rawStart;
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (word.endTime > word.startTime) continue;
    const nextStart = words[index + 1]?.startTime;
    word.endTime = nextStart !== undefined && nextStart > word.startTime ? nextStart : rawEnd;
  }
};

/** LRCN Trans 的逐字发音在已按行 ID 匹配的行内按时间对齐。 */
const alignLntRomanWords = (
  words: LyricLine["words"],
  romanWords: LyricLine["words"],
  offset: number,
): void => {
  if (words.length === 0 || romanWords.length === 0) return;
  let searchStart = 0;
  for (const word of words) {
    if (!/[\p{L}\p{N}]/u.test(word.word)) continue;
    let matched = -1;
    let bestOverlap = 0;
    let exactStart = false;
    for (let candidate = searchStart; candidate < romanWords.length; candidate++) {
      const roman = romanWords[candidate];
      const wordStart = word.startTime;
      const wordEnd = word.endTime;
      const romanStart = roman.startTime + offset;
      const romanEnd = roman.endTime + offset;
      if (Math.abs(wordStart - romanStart) <= 2) {
        matched = candidate;
        exactStart = true;
        break;
      }
      const overlap = Math.max(0, Math.min(wordEnd, romanEnd) - Math.max(wordStart, romanStart));
      const union = Math.max(wordEnd, romanEnd) - Math.min(wordStart, romanStart);
      if (union > 0 && overlap / union > bestOverlap) {
        bestOverlap = overlap / union;
        matched = candidate;
      }
    }
    if (!exactStart && bestOverlap < 0.1) matched = -1;
    const roman = romanWords[matched];
    const romanText = roman?.word.trim();
    if (romanText) {
      word.romanWord = romanText;
      searchStart = Math.max(searchStart, matched + 1);
    }
  }
};

/** 对齐容差（毫秒） */
const ALIGN_TOLERANCE_MS = 300;

/** 翻译/音译文本去首尾空白 */
const lineText = (line: LyricLine): string =>
  line.words
    .map((w) => w.word)
    .join("")
    .trim();

/** 是否为有意义的翻译文本 */
const isMeaningfulTrans = (text: string): boolean =>
  !!text && text !== "//" && !text.includes("作品的著作权");

/**
 * 将翻译/音译歌词按时间戳对齐到主歌词行
 * @param lines 主歌词行数组（会被原地修改）
 * @param transLines 已解析的翻译/音译歌词行
 * @param field 写入目标字段："translatedLyric" 或 "romanLyric"
 */
export const pairTranslation = (
  lines: LyricLine[],
  transLines: LyricLine[],
  field: "translatedLyric" | "romanLyric",
): void => {
  pairTranslationByType(
    lines.filter((line) => !line.isBG),
    transLines.filter((line) => !line.isBG),
    field,
  );
  pairBackgroundTranslation(lines, transLines, field);
};

/** 背景行的时间戳可能来自所属主行，按主行时间而不是背景行自身时间配对。 */
const pairBackgroundTranslation = (
  lines: LyricLine[],
  transLines: LyricLine[],
  field: "translatedLyric" | "romanLyric",
): void => {
  const targets = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.isBG);
  const trans = transLines.map((line, index) => ({ line, index })).filter(({ line }) => line.isBG);
  const parentStart = (items: LyricLine[], index: number): number | undefined => {
    for (let cursor = index - 1; cursor >= 0; cursor--) {
      if (!items[cursor].isBG) return items[cursor].startTime;
    }
    return undefined;
  };
  const used = new Set<number>();
  for (const target of targets) {
    const targetStart = parentStart(lines, target.index);
    if (targetStart === undefined) continue;
    let match = -1;
    let bestDiff = ALIGN_TOLERANCE_MS + 1;
    for (const candidate of trans) {
      if (used.has(candidate.index)) continue;
      const candidateStart = parentStart(transLines, candidate.index);
      if (candidateStart === undefined) continue;
      const diff = Math.abs(targetStart - candidateStart);
      if (diff <= ALIGN_TOLERANCE_MS && diff < bestDiff) {
        bestDiff = diff;
        match = candidate.index;
      }
    }
    if (match === -1) continue;
    const candidate = trans.find((item) => item.index === match);
    if (!candidate) continue;
    const text = lineText(candidate.line);
    if (isMeaningfulTrans(text)) target.line[field] = text;
    used.add(match);
  }
};

/** 主行按时间戳对齐；背景行遵循 LRCN 的出现顺序。 */
const pairTranslationByType = (
  lines: LyricLine[],
  transLines: LyricLine[],
  field: "translatedLyric" | "romanLyric",
): void => {
  const targets = [...lines].sort((a, b) => a.startTime - b.startTime);
  const trans = [...transLines].sort((a, b) => a.startTime - b.startTime);
  if (targets[0]?.isBG) {
    for (let index = 0; index < trans.length && index < targets.length; index++) {
      const text = lineText(trans[index]);
      if (isMeaningfulTrans(text)) targets[index][field] = text;
    }
    return;
  }
  let i = 0;
  let j = 0;
  while (i < targets.length && j < trans.length) {
    const diff = targets[i].startTime - trans[j].startTime;
    if (Math.abs(diff) <= ALIGN_TOLERANCE_MS) {
      const text = lineText(trans[j]);
      if (isMeaningfulTrans(text)) targets[i][field] = text;
      i++;
      j++;
    } else if (diff < 0) {
      i++;
    } else {
      j++;
    }
  }
};
