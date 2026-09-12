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
  it("正文脚本优先于错误的语言标签", () => {
    const lines = [
      {
        words: [{ word: "ループザルーム", startTime: 0, endTime: 1 }],
        language: "und-Latn",
      },
    ] as LyricLine[];

    applyLyricLanguages(lines);

    assert.equal(lines[0].language, "ja");
  });

  it("正文无法判断时回退到语言标签", () => {
    const lines = [
      {
        words: [{ word: "愛", startTime: 0, endTime: 1 }],
        language: "ja",
      },
    ] as LyricLine[];

    applyLyricLanguages(lines);

    assert.equal(lines[0].language, "ja");
  });

  it("假名未达到整曲占比阈值时不替纯汉字行猜测语言", () => {
    const lines = [createLine("愛"), createLine("君が好き")];

    applyLyricLanguages(lines);

    assert.deepEqual(
      lines.map((line) => line.language),
      ["und-Hani", "ja"],
    );
  });

  it("假名达到整曲占比阈值后将纯汉字行识别为日语", () => {
    const lines = [createLine("爱"), createLine("君が好き", { translatedLyric: "我喜欢你" })];

    applyLyricLanguages(lines);

    assert.deepEqual(
      lines.map((line) => line.language),
      ["zh-CN", "ja"],
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

  it("正文证据达到阈值时覆盖错误的显式语言", () => {
    const lines = [createLine("我爱你", { language: "ja" })];

    applyLyricLanguages(lines);

    assert.equal(lines[0].language, "zh-CN");
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
