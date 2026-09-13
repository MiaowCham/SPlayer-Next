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
  it("强制分隔覆盖 CJK 手工空格，但保留音节内部文字与时间", () => {
    const line = createLine("", ["ko", "ko ro  ", "ni"]);
    line.preserveRomanizationSpacing = true;
    const result = promotePronunciation(line, "word", true);
    expect(result.words.map((word) => word.word)).toEqual(["ko ", "ko ro ", "ni"]);
    expect(result.words.map(({ startTime, endTime }) => [startTime, endTime])).toEqual(
      line.words.map(({ startTime, endTime }) => [startTime, endTime]),
    );
    expect(promotePronunciation(line, "word").words.map((word) => word.word)).toEqual([
      "ko",
      "ko ro  ",
      "ni",
    ]);
    expect(promoteDefaultPronunciation([line], false, true)[0]).toEqual(result);
  });

  it("强制分隔仍优先复用等价原文，非 CJK 发音只复制原文边界", () => {
    const line = createLine("", ["wake  ", "up", "ha ", "lo ", "ni", "hao"]);
    ["Wake ", "up, ", "he", "llo ", "你", "好"].forEach((word, index) => {
      line.words[index].word = word;
    });
    line.preserveRomanizationSpacing = true;
    expect(promotePronunciation(line, "word", true).words.map((word) => word.word)).toEqual([
      "Wake ",
      "up, ",
      "ha",
      "lo ",
      "ni ",
      "hao",
    ]);
  });

  it("强制分隔不重复添加 TTML 的独立空白词元", () => {
    const line = createLine("", ["ni", undefined, "hao"]);
    line.words[1].word = " ";
    expect(promotePronunciation(line, "word", true).words.map((word) => word.word)).toEqual([
      "ni ",
      "",
      "hao",
    ]);
  });

  it("等价英文复用原文时保留 TTML 独立空格词元", () => {
    const line = createLine("", ["wake ", undefined, "up"]);
    line.words[0].word = "Wake";
    line.words[1].word = " ";
    line.words[2].word = "up,";
    expect(
      promotePronunciation(line, "word")
        .words.map((word) => word.word)
        .join(""),
    ).toBe("Wake up,");
  });
  it("等价英文优先使用原文，不被同句手工空格覆盖", () => {
    const line = createLine("", ["wake ", "up ", "wake ", "up ", "babe ", "saa ", "i ", "ma"]);
    const originals = ["Wake ", "up, ", "wake ", "up, ", "babe ", "さ", "あ", "いま"];
    line.words.forEach((word, index) => {
      word.word = originals[index];
    });
    for (const explicit of [undefined, true]) {
      line.preserveRomanizationSpacing = explicit;
      expect(promotePronunciation(line, "word").words.map((word) => word.word)).toEqual([
        "Wake ",
        "up, ",
        "wake ",
        "up, ",
        "babe ",
        "saa ",
        "i ",
        "ma",
      ]);
    }
  });

  it("逐句判断手工空格，句首句尾留白不妨碍其他句自动分隔", () => {
    const edited = createLine("", ["ni  ", "hao", "ma"]);
    const automatic = createLine("", [" toriko", "ni", "natteita "]);
    automatic.words.forEach((word, index) => {
      word.word = ["虜", "に", "なっていた"][index];
    });
    for (const lines of [
      [edited, automatic],
      [automatic, edited],
    ]) {
      const results = promoteDefaultPronunciation(lines, false);
      expect(results[lines.indexOf(edited)].words.map((word) => word.word)).toEqual([
        "ni  ",
        "hao",
        "ma",
      ]);
      expect(results[lines.indexOf(automatic)].words.map((word) => word.word)).toEqual([
        "toriko ",
        "ni ",
        "natteita",
      ]);
    }
    expect(automatic.words[0].romanWord).toBe(" toriko");
  });

  it("手工发音空格覆盖 CJK 自动分隔，并保留连续空格", () => {
    const line = createLine("", ["ni  ", "hao", "ma"]);
    const result = promotePronunciation(line, "word");
    expect(result.words.map((word) => word.word)).toEqual(["ni  ", "hao", "ma"]);
  });

  it("无显式空格时，非 CJK 等价音节直接复用原文的符号与大小写", () => {
    const line = createLine("", ["hello", "world"]);
    line.words[0].word = "HELLO, ";
    line.words[1].word = "World!";
    expect(promotePronunciation(line, "word").words.map((word) => word.word)).toEqual([
      "HELLO, ",
      "World!",
    ]);
  });

  it("LRCN 发音音节内部已有空格时也不追加分隔", () => {
    const line = createLine("", ["ko", "ko ro", "ni"]);
    line.preserveRomanizationSpacing = true;
    expect(promotePronunciation(line, "word").words.map((word) => word.word)).toEqual([
      "ko",
      "ko ro",
      "ni",
    ]);
  });

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
      { word: "ku taru", romanWord: "词1" },
    ]);
  });

  it("发音已有显式空格时保留全部空格，不按原文重排", () => {
    const line = createLine("", ["hel-lo ", "world "]);
    line.words[0].word = "hello world";
    line.words[1].word = "again";

    const promoted = promotePronunciation(line, "word");

    expect(promoted.words.map((word) => word.word)).toEqual(["hel-lo ", "world "]);
  });

  it("提升日文假名逐字发音时也给每个音节补分隔空格", () => {
    const line = createLine("", ["ko", "ko ro"]);
    line.words[0].word = "こ";
    line.words[1].word = "ころ";

    const promoted = promotePronunciation(line, "word");

    expect(promoted.words.map((word) => word.word)).toEqual(["ko ", "ko ro"]);
  });

  it("提升非 CJK 逐字发音时识别相邻音节之间的空格", () => {
    const line = createLine("", ["həlo", "wɜːld"]);
    line.words[0].word = "hello";
    line.words[1].word = " world";

    const promoted = promotePronunciation(line, "word");

    expect(promoted.words.map((word) => word.word)).toEqual(["həlo", " wɜːld"]);
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
    expect(promoted.words.map((word) => word.word)).toEqual(["ci ", "ling"]);
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
