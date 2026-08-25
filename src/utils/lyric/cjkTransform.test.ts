import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { LyricLine } from "@shared/types/lyrics";
import { applyLyricCjkTransform } from "./cjkTransform";

type OpenccWindow = {
  api?: {
    opencc?: {
      convertBatch: (texts: string[], mode: string) => Promise<string[]>;
    };
  };
};

const globalWindow = globalThis as unknown as { window?: OpenccWindow };

const createLine = (content: string, options: Partial<LyricLine> = {}): LyricLine => ({
  language: "zh-CN",
  words: [{ word: content, startTime: 0, endTime: 1000 }],
  translatedLyric: "",
  romanLyric: "",
  startTime: 0,
  endTime: 1000,
  isBG: false,
  isDuet: false,
  ...options,
});

afterEach(() => {
  delete globalWindow.window;
});

describe("applyLyricCjkTransform", () => {
  it("只转换确认是中文的正文和翻译，保留日文与发音", async () => {
    const calls: Array<{ texts: string[]; mode: string }> = [];
    globalWindow.window = {
      api: {
        opencc: {
          convertBatch: async (texts, mode) => {
            calls.push({ texts, mode });
            return texts.map((text) => text.replaceAll("爱", "愛").replaceAll("欢", "歡"));
          },
        },
      },
    };
    const lines = [
      createLine("我爱你", {
        translatedLyric: "我喜欢你",
        romanLyric: "wǒ ài nǐ",
        words: [
          {
            word: "我爱你",
            startTime: 0,
            endTime: 1000,
            romanWord: "wǒ ài nǐ",
            ruby: [{ word: "あい", startTime: 0, endTime: 1000 }],
          },
        ],
      }),
      createLine("愛", {
        language: "ja",
        translatedLyric: "君が好き",
        romanLyric: "ai",
        words: [
          {
            word: "愛",
            startTime: 0,
            endTime: 1000,
            ruby: [{ word: "あい", startTime: 0, endTime: 1000 }],
          },
        ],
      }),
      createLine("未来", { language: "und-Hani" }),
    ];

    const result = await applyLyricCjkTransform(lines, "traditional");

    assert.deepEqual(calls, [{ texts: ["我喜欢你", "我爱你"], mode: "s2t" }]);
    assert.equal(result[0].words[0].word, "我愛你");
    assert.equal(result[0].translatedLyric, "我喜歡你");
    assert.equal(result[0].words[0].ruby?.[0].word, "あい");
    assert.equal(result[0].words[0].romanWord, "wǒ ài nǐ");
    assert.equal(result[0].romanLyric, "wǒ ài nǐ");
    assert.equal(result[1].words[0].word, "愛");
    assert.equal(result[1].translatedLyric, "君が好き");
    assert.equal(result[1].words[0].ruby?.[0].word, "あい");
    assert.equal(result[2].words[0].word, "未来");
  });

  it("偏好简体使用 t2s，默认偏好不调用 OpenCC", async () => {
    const calls: Array<{ texts: string[]; mode: string }> = [];
    globalWindow.window = {
      api: {
        opencc: {
          convertBatch: async (texts, mode) => {
            calls.push({ texts, mode });
            return texts.map((text) => text.replaceAll("愛", "爱"));
          },
        },
      },
    };
    const lines = [createLine("我愛你")];

    const simplified = await applyLyricCjkTransform(lines, "simplified");
    const unchanged = await applyLyricCjkTransform(lines, "default");

    assert.deepEqual(calls, [{ texts: ["我愛你"], mode: "t2s" }]);
    assert.equal(simplified[0].words[0].word, "我爱你");
    assert.strictEqual(unchanged, lines);
  });
});
