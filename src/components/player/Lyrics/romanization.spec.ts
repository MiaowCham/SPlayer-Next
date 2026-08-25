import type { LyricLine } from "@shared/types/lyrics";
import { describe, expect, it } from "vitest";
import {
  canPromoteLinePronunciation,
  collapseToLineLyric,
  hasWordRomanization,
  promoteDefaultPronunciation,
  promotePronunciation,
  resolveAmlLineRomanization,
  resolveDefaultRomanization,
  shouldForceAmlLinePronunciationMode,
  shouldForceLinePronunciationMode,
} from "./romanization";

const createLine = (romanLyric: string, romanWords: Array<string | undefined>): LyricLine => ({
  words: romanWords.map((romanWord, index) => ({
    word: `词${index}`,
    romanWord,
    startTime: index * 100,
    endTime: (index + 1) * 100,
  })),
  translatedLyric: "",
  romanLyric,
  startTime: 0,
  endTime: 200,
  isBG: false,
  isDuet: false,
});

describe("歌词音译渲染准备", () => {
  it("默认渲染器优先保留逐行音译，缺失时以空格拼接逐字发音", () => {
    expect(resolveDefaultRomanization(createLine("ni hao", ["ni", "hao"]))).toBe("ni hao");
    expect(resolveDefaultRomanization(createLine("", [" ni ", "hao"]))).toBe("ni hao");
  });

  it("AMLL 有逐字发音时不传递逐行音译，也不主动拼接", () => {
    const wordAndLine = createLine("ni hao", ["ni", "hao"]);
    const lineOnly = createLine("ni hao", []);

    expect(hasWordRomanization(wordAndLine)).toBe(true);
    expect(resolveAmlLineRomanization(wordAndLine, true)).toBe("");
    expect(resolveAmlLineRomanization(lineOnly, true)).toBe("ni hao");
    expect(resolveAmlLineRomanization(lineOnly, false)).toBe("");
  });

  it("AMLL 强制逐行模式不会覆盖逐字发音", () => {
    const wordAndLine = createLine("ni hao", ["ni", "hao"]);
    const lineOnly = createLine("ni hao", [undefined, undefined]);

    expect(shouldForceAmlLinePronunciationMode([wordAndLine], true)).toBe(false);
    expect(shouldForceAmlLinePronunciationMode([lineOnly], true)).toBe(true);
    expect(shouldForceAmlLinePronunciationMode([lineOnly], false)).toBe(false);
  });

  it("提升 CJK 逐字发音时保留内部空格并给每个音节补分隔空格", () => {
    const line = createLine("", ["词0", "ku taru"]);
    const promoted = promotePronunciation(line, "word");

    expect(promoted.words.map(({ word, romanWord }) => ({ word, romanWord }))).toEqual([
      { word: "词0", romanWord: "词0" },
      { word: "ku taru ", romanWord: "词1" },
    ]);
  });

  it("提升非 CJK 逐字发音时跟随原歌词音节内的空格", () => {
    const line = createLine("", ["hel-lo ", "world "]);
    line.words[0].word = "hello world";
    line.words[1].word = "again";

    const promoted = promotePronunciation(line, "word");

    expect(promoted.words.map((word) => word.word)).toEqual(["hel-lo ", "world"]);
  });

  it("提升日文假名逐字发音时也给每个音节补分隔空格", () => {
    const line = createLine("", ["ko", "ko ro"]);
    line.words[0].word = "こ";
    line.words[1].word = "ころ";

    const promoted = promotePronunciation(line, "word");

    expect(promoted.words.map((word) => word.word)).toEqual(["ko ", "ko ro "]);
  });

  it("提升非 CJK 逐字发音时识别相邻音节之间的空格", () => {
    const line = createLine("", ["həlo", "wɜːld "]);
    line.words[0].word = "hello";
    line.words[1].word = " world";

    const promoted = promotePronunciation(line, "word");

    expect(promoted.words.map((word) => word.word)).toEqual(["həlo ", "wɜːld"]);
  });

  it("提升非 CJK 逐字发音时保留独立空白词元且不重复补空格", () => {
    const line = createLine("", ["həlo", undefined, "wɜːld"]);
    line.words[0].word = "hello";
    line.words[1].word = " ";
    line.words[2].word = "world";

    const promoted = promotePronunciation(line, "word");

    expect(promoted.words.map((word) => word.word)).toEqual(["həlo", " ", "wɜːld"]);
  });

  it("强制模式使用逐行发音替换逐字主歌词并让整首保持逐句结构", () => {
    const line = createLine("ci ling fa yin", ["ci", "ling"]);
    const plainLine = createLine("", [undefined, undefined]);

    expect(shouldForceLinePronunciationMode([line, plainLine], true)).toBe(true);
    expect(canPromoteLinePronunciation(line, true)).toBe(true);

    const promoted = promotePronunciation(line, "line");
    const collapsed = collapseToLineLyric(plainLine);
    expect(promoted.isLineLyric).toBe(true);
    expect(promoted.words).toHaveLength(1);
    expect(promoted.words[0].word).toBe("ci ling fa yin");
    expect(collapsed.isLineLyric).toBe(true);
    expect(collapsed.words).toHaveLength(1);
  });

  it("默认渲染器将 TTML/LRCN 的逐词发音提升为逐字主歌词", () => {
    const line = createLine("", ["ci", "ling"]);
    const [promoted] = promoteDefaultPronunciation([line], true);

    expect(promoted.isLineLyric).toBeUndefined();
    expect(promoted.words.map((word) => word.word)).toEqual(["ci ", "ling "]);
    expect(promoted.words.map((word) => word.romanWord)).toEqual(["词0", "词1"]);
  });

  it("逐行发音提升时按西文习惯补全原文符号", () => {
    const quoted = createLine("mou ii yo", [undefined]);
    quoted.words[0].word = "「もういいよ」";
    const prolonged = createLine("a Tel mail tome te", [undefined]);
    prolonged.words[0].word = "あー Tel mail 止めて";

    expect(promotePronunciation(quoted, "line").words[0].word).toBe('"mou ii yo"');
    expect(promotePronunciation(prolonged, "line").words[0].word).toBe("a- Tel mail tome te");
  });
});
