import type { LyricLine } from "@shared/types/lyrics";
import { describe, expect, it } from "vitest";
import {
  hasWordRomanization,
  resolveAmlLineRomanization,
  resolveDefaultRomanization,
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
});
