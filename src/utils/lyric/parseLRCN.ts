import type { LyricLine, LyricWord } from "@shared/types/lyrics";
import type { Platform } from "@shared/types/platform";
import { MAX_TIME, parseTime } from "./timestamp";

interface ParsedLine {
  line: LyricLine;
  id?: string;
}

export interface ParsedLRCN {
  lines: LyricLine[];
  lineIds: Map<LyricLine, string>;
  offset: number;
}

export interface ParsedLNTLine {
  id?: string;
  isBG: boolean;
  text: string;
  words: LyricWord[];
  startTime?: number;
  hasTimedWords: boolean;
}

const TIME_RE = /^\d+(?::\d+){0,2}(?:\.\d{1,3})?$/;

/** 将 LRCN 使用的 SMIL 时钟值转换为毫秒。 */
const parseSmilTime = (value: string): number | null => {
  const text = value.trim();
  if (!TIME_RE.test(text)) return null;
  const parts = text.split(":");
  const last = parts.pop()!;
  const [secondText, fraction = ""] = last.split(".");
  const second = Number(secondText);
  const minute = parts.length > 0 ? Number(parts.pop()) : 0;
  const hour = parts.length > 0 ? Number(parts.pop()) : 0;
  if (![hour, minute, second].every(Number.isFinite)) return null;
  const ms = fraction ? Number(fraction.padEnd(3, "0").slice(0, 3)) : 0;
  return Math.min(((hour * 60 + minute) * 60 + second) * 1000 + ms, MAX_TIME);
};

const parseLrcStart = (value: string): number | null => {
  const match = /^(\d+):(\d+)(?:[.:](\d{1,3}))?$/.exec(value.trim());
  return match ? parseTime(match[1], match[2], match[3] ?? "0") : null;
};

const parseStart = (value: string): number | null => parseSmilTime(value) ?? parseLrcStart(value);

const emptyLine = (
  startTime: number,
  endTime: number,
  words: LyricWord[],
  isBG = false,
  isDuet = false,
): LyricLine => ({
  words,
  translatedLyric: "",
  romanLyric: "",
  startTime,
  endTime,
  isBG,
  isDuet,
});

const applyOffset = (time: number, offset: number): number => Math.max(0, time + offset);

const resolveOffset = (text: string, platform?: Platform): number => {
  let common = 0;
  let platformOffset: number | undefined;
  for (const match of text.matchAll(/^\[offset:([^\]]+)\]$/gim)) {
    const [targetText, valueText] = match[1].split("@");
    const target = valueText === undefined ? undefined : targetText.trim().toLowerCase();
    const value = Number(valueText ?? targetText);
    if (!Number.isFinite(value)) continue;
    if (!target) common = value;
    else if (platform && target === platform) platformOffset = value;
  }
  return platformOffset ?? common;
};

const parseWords = (body: string, lineStart: number, offset: number): LyricWord[] => {
  const matches = [...body.matchAll(/<([^,>]+)(?:,([^>]+))?>/g)];
  if (matches.length === 0) {
    const word = body.trim();
    return word ? [{ word, startTime: applyOffset(lineStart, offset), endTime: 0 }] : [];
  }
  const words: LyricWord[] = [];
  const firstText = body.slice(0, matches[0].index).trim();
  if (firstText)
    words.push({ word: firstText, startTime: applyOffset(lineStart, offset), endTime: 0 });
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const nextIndex = matches[index + 1]?.index ?? body.length;
    const word = body.slice((match.index ?? 0) + match[0].length, nextIndex);
    if (!word) continue;
    const start = parseStart(match[1]);
    if (start === null) continue;
    const end = match[2] ? parseStart(match[2]) : null;
    words.push({
      word,
      startTime: applyOffset(start, offset),
      endTime: end === null ? 0 : applyOffset(end, offset),
    });
  }
  for (let index = 0; index < words.length - 1; index++) {
    if (words[index].endTime <= words[index].startTime)
      words[index].endTime = words[index + 1].startTime;
  }
  return words;
};

/** 背景歌词常以括号包裹，逐字标签可能将首尾括号拆到不同单词中。 */
const stripBackgroundBrackets = (words: LyricWord[]): void => {
  const first = words[0];
  if (first?.word.startsWith("(") || first?.word.startsWith("（")) {
    first.word = first.word.slice(1);
    if (!first.word) words.shift();
  }
  const last = words.at(-1);
  if (last?.word.endsWith(")") || last?.word.endsWith("）")) {
    last.word = last.word.slice(0, -1);
    if (!last.word) words.pop();
  }
};

/** 清除背景行正文最外层的中英文括号。 */
const stripBackgroundText = (text: string): string =>
  text
    .trim()
    .replace(/^[（(]\s*/, "")
    .replace(/\s*[）)]$/, "")
    .trim();

/** 读取 LRCN 声明的 Agent 类型。 */
const parseAgentTypes = (text: string): Map<string, string> => {
  const types = new Map<string, string>();
  for (const match of text.matchAll(/^\[agent:([^@,\]]+)@([^,\]]+)\]$/gim)) {
    types.set(match[2].trim(), match[1].trim().toLowerCase());
  }
  return types;
};

/** 根据 Agent ID 计算对唱方向，特殊 Agent 不参与后续比较。 */
const createDuetResolver = (agentTypes: Map<string, string>) => {
  let previousAgentId: string | undefined;
  let previousIsDuet: boolean | undefined;
  return (agentId?: string): boolean => {
    const agentType = agentId ? agentTypes.get(agentId) : undefined;
    if (agentType === "group") return false;
    if (agentType === "other") return true;
    if (previousIsDuet === undefined) {
      const isDuet = agentId === "v2";
      previousAgentId = agentId;
      previousIsDuet = isDuet;
      return isDuet;
    }
    const isDuet = agentId === previousAgentId ? previousIsDuet : !previousIsDuet;
    previousAgentId = agentId;
    previousIsDuet = isDuet;
    return isDuet;
  };
};

/** 解析 LRCN 主歌词，行 ID 仅供同模块的 LNT 配对使用。 */
export const parseLRCN = (text: string, platform?: Platform): ParsedLRCN => {
  const offset = resolveOffset(text, platform);
  const resolveDuet = createDuetResolver(parseAgentTypes(text));
  const parsed: ParsedLine[] = [];
  let previousMain: ParsedLine | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const row = raw.trim();
    if (
      !row ||
      row === "[Lyrics Next]" ||
      /^\[(version|timing|lang|songwriter|agent|by|offset):/i.test(row)
    )
      continue;
    const match = /^\[([^\]]+)\](.*)$/.exec(row);
    if (!match) continue;
    const tag = match[1].trim();
    const body = match[2];
    if (tag === "song-part" || tag.split(",").includes("song-part")) continue;
    if (tag === "x-bg") {
      if (!previousMain) continue;
      const words = parseWords(body, previousMain.line.startTime - offset, offset);
      stripBackgroundBrackets(words);
      const line = emptyLine(
        words[0]?.startTime ?? previousMain.line.startTime,
        words.at(-1)?.endTime || previousMain.line.endTime,
        words,
        true,
        previousMain.line.isDuet,
      );
      parsed.push({ line, id: previousMain.id });
      continue;
    }
    const parts = tag.split(",").map((part) => part.trim());
    const start = parseStart(parts[0]);
    if (start === null) continue;
    const end = parts[1] ? parseStart(parts[1]) : null;
    const agentId = parts.length >= 3 ? parts[2] || undefined : undefined;
    const id = parts.length >= 4 ? parts[3] || undefined : undefined;
    const words = parseWords(body, start, offset);
    const lineStart = applyOffset(start, offset);
    const lineEnd = end === null ? words.at(-1)?.endTime || 0 : applyOffset(end, offset);
    const current: ParsedLine = {
      line: emptyLine(lineStart, lineEnd, words, false, resolveDuet(agentId)),
      id,
    };
    parsed.push(current);
    previousMain = current;
  }
  for (let index = 0; index < parsed.length; index++) {
    const current = parsed[index];
    if (current.line.isBG || current.line.endTime > current.line.startTime) continue;
    const next = parsed.slice(index + 1).find((item) => !item.line.isBG);
    current.line.endTime = next?.line.startTime ?? MAX_TIME;
    const lastWord = current.line.words.at(-1);
    if (lastWord && lastWord.endTime <= lastWord.startTime) lastWord.endTime = current.line.endTime;
    if (current.line.words.length === 1) current.line.words[0].endTime = current.line.endTime;
  }
  const lineIds = new Map<LyricLine, string>();
  for (const item of parsed) if (item.id) lineIds.set(item.line, item.id);
  return { lines: parsed.map((item) => item.line), lineIds, offset };
};

/** 解析 LRCN Trans 的行标识、正文与逐字时间，供翻译/发音精确配对。 */
export const parseLNT = (text: string): ParsedLNTLine[] => {
  const result: ParsedLNTLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const match = /^\[([^\]]+)\](.*)$/.exec(raw.trim());
    if (!match) continue;
    const tag = match[1].trim();
    if (/^(translate|transliteration|lang):/i.test(tag)) continue;
    if (tag === "x-bg") {
      const words = parseWords(match[2], 0, 0);
      stripBackgroundBrackets(words);
      result.push({
        isBG: true,
        text: stripBackgroundText(match[2].replace(/<[^>]+>/g, "")),
        words,
        hasTimedWords: /<[^>]+>/.test(match[2]),
      });
      continue;
    }
    const parts = tag.split(",").map((part) => part.trim());
    const id = parts.length >= 2 ? parts[1] : parts[0];
    if (!id || parseStart(id) !== null || /^\d+$/.test(id)) continue;
    const startTime = parts.length >= 2 ? (parseStart(parts[0]) ?? undefined) : undefined;
    const words = parseWords(match[2], startTime ?? 0, 0);
    result.push({
      id,
      isBG: false,
      text: match[2].replace(/<[^>]+>/g, "").trim(),
      words,
      startTime,
      hasTimedWords: /<[^>]+>/.test(match[2]),
    });
  }
  return result;
};
