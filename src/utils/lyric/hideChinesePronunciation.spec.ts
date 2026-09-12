import { describe, expect, it } from "vitest";
import type { LyricLine } from "@shared/types/lyrics";
import { hideChinesePronunciation } from "./hideChinesePronunciation";
import { parseLyric } from "./parse";

/**
 * 创建不依赖歌曲文件的发音测试行。
 * @param original - 正文
 * @param pronunciation - 逐行发音
 * @returns 最小可渲染歌词行
 */
const line = (original: string, pronunciation: string): LyricLine => ({
  words: [{ word: original, startTime: 0, endTime: 1000 }],
  romanLyric: pronunciation,
  translatedLyric: "保留译文",
  startTime: 0,
  endTime: 1000,
  isBG: false,
  isDuet: false,
});

describe("隐藏中文发音", () => {
  it.each([
    ["你好", "nǐ hǎo"],
    ["你好", "ni hao"],
    ["你好", "NIHAO"],
    ["你好", "ni3 hao3"],
    ["汉语拼音", "han4yu3pin1yin1"],
    ["女儿", "nü er"],
    ["女儿", "nv er"],
    ["女儿", "nu: er"],
    ["你好！", "nǐ hǎo!"],
    ["重逢", "chong feng"],
    ["音乐", "yin yue"],
    ["爱你", "ai ni"],
    ["我", "wǒ"],
  ])("匹配普通话：%s / %s", async (original, pronunciation) => {
    const input = line(original, pronunciation);
    const [result] = await hideChinesePronunciation([input]);
    expect(result.romanLyric).toBe("");
    expect(result.words).toEqual(input.words);
    expect(result.translatedLyric).toBe("保留译文");
    expect(input.romanLyric).toBe(pronunciation);
  });

  it.each([
    ["你好", "nei5 hou2"],
    ["你好", "nei hou"],
    ["我愛你", "ngo5 oi3 nei5"],
    ["廣東話", "gwong2 dung1 waa2"],
    ["世界", "sai3 gaai3"],
    ["多謝", "do1 ze6"],
    ["你好", "ㄋㄧˇ ㄏㄠˇ"],
    ["你好", "ni ha"],
    ["你好", "hello"],
    ["都", "dou1"],
    ["都都", "dou1 dou1"],
    ["你好", "ní hảo"],
    ["虜", "toriko"],
    ["Hello", "hello"],
    ["你好 Hello", "ni hao hello"],
  ])("保留粤拼、其他发音或不确定内容：%s / %s", async (original, pronunciation) => {
    const input = line(original, pronunciation);
    const [result] = await hideChinesePronunciation([input]);
    expect(result).toBe(input);
  });

  it("逐句判断并统一处理逐字发音，不改变原始对象", async () => {
    const mandarin = line("", "");
    mandarin.words = [
      { word: "你", romanWord: "ni", startTime: 0, endTime: 500 },
      { word: "好", romanWord: "hao", startTime: 500, endTime: 1000 },
    ];
    const cantonese = line("", "");
    cantonese.words = [
      { word: "你", romanWord: "nei5", startTime: 0, endTime: 500 },
      { word: "好", romanWord: "hou2", startTime: 500, endTime: 1000 },
    ];
    const [filtered, kept] = await hideChinesePronunciation([mandarin, cantonese]);
    expect(filtered.words.map((word) => word.romanWord)).toEqual([undefined, undefined]);
    expect(kept).toBe(cantonese);
    expect(mandarin.words.map((word) => word.romanWord)).toEqual(["ni", "hao"]);
  });

  it("混合语言逐字行只移除明确的中文拼音，保留英文及日文", async () => {
    const input = line("", "");
    input.words = [
      { word: "你好", romanWord: "ni hao", startTime: 0, endTime: 300 },
      { word: "Wake", romanWord: "wake", startTime: 300, endTime: 600 },
      { word: "虜", romanWord: "toriko", startTime: 600, endTime: 1000 },
    ];
    const [result] = await hideChinesePronunciation([input]);
    expect(result.words.map((word) => word.romanWord)).toEqual([undefined, "wake", "toriko"]);
  });

  it("仅移除汉语拼音 ruby，保留其他注音", async () => {
    const input = line("你好", "");
    input.words[0].ruby = [{ word: "nǐ hǎo", startTime: 0, endTime: 1000 }];
    expect((await hideChinesePronunciation([input]))[0].words[0].ruby).toBeUndefined();
    input.words[0].ruby = [{ word: "nei5 hou2", startTime: 0, endTime: 1000 }];
    expect((await hideChinesePronunciation([input]))[0]).toBe(input);
  });

  it.each(["ja", "ko", "yue"] as const)("尊重显式 %s 语言标签", async (language) => {
    const input = { ...line("你好", "ni hao"), language };
    expect((await hideChinesePronunciation([input]))[0]).toBe(input);
  });

  it.each(["yue", "zh-yue", "yue-Hant"])("TTML 保留 %s 标签并保护整句", async (language) => {
    const lines = parseLyric(
      {
        content: `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xml:lang="${language}"><body><div><p begin="0s" end="1s">你好<span ttm:role="x-roman">ni hao</span></p></div></body></tt>`,
      },
      "ttml",
    );
    expect(lines[0].language).toBe("yue");
    expect((await hideChinesePronunciation(lines))[0].romanLyric).toBe("ni hao");
  });
});
