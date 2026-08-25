import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LyricLine } from "@shared/types/lyrics";
import { applyLyricLanguages } from "./language";

const createLine = (content: string, options: Partial<LyricLine> = {}): LyricLine => ({
  words: [{ word: content, startTime: 0, endTime: 1000 }],
  translatedLyric: "",
  romanLyric: "",
  startTime: 0,
  endTime: 1000,
  isBG: false,
  isDuet: false,
  ...options,
});

describe("applyLyricLanguages", () => {
  it("用假名上下文将纯汉字行识别为日语", () => {
    const lines = [createLine("愛"), createLine("君が好き")];

    applyLyricLanguages(lines);

    assert.deepEqual(
      lines.map((line) => line.language),
      ["ja", "ja"],
    );
  });

  it("整首出现假名时不把纯汉字行识别为中文", () => {
    const lines = [createLine("爱"), createLine("君が好き", { translatedLyric: "我喜欢你" })];

    applyLyricLanguages(lines);

    assert.deepEqual(
      lines.map((line) => line.language),
      ["ja", "ja"],
    );
  });

  it("仅将有简体中文证据的纯汉字行识别为中文", () => {
    const lines = [createLine("我爱你"), createLine("未来")];

    applyLyricLanguages(lines);

    assert.deepEqual(
      lines.map((line) => line.language),
      ["zh-CN", "und-Hani"],
    );
  });

  it("在没有假名的日文纯汉字歌词中保持保守", () => {
    const lines = [createLine("愛"), createLine("未来")];

    applyLyricLanguages(lines);

    assert.deepEqual(
      lines.map((line) => line.language),
      ["und-Hani", "und-Hani"],
    );
  });

  it("不覆盖解析器提供的显式语言", () => {
    const lines = [createLine("我爱你", { language: "ja" })];

    applyLyricLanguages(lines);

    assert.equal(lines[0].language, "ja");
  });

  it("不把拉丁文字断言为英语", () => {
    const lines = [createLine("Hello world"), createLine("Hola mundo")];

    applyLyricLanguages(lines);

    assert.deepEqual(
      lines.map((line) => line.language),
      ["und-Latn", "und-Latn"],
    );
  });

  it("未知脚本、数字和标点不设置语言", () => {
    const lines = [createLine("Привет"), createLine("123 ...")];

    applyLyricLanguages(lines);

    assert.deepEqual(
      lines.map((line) => line.language),
      [undefined, undefined],
    );
  });
});
