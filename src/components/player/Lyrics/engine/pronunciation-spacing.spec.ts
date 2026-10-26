import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LyricRenderer } from "lyric-dom";
import type { LyricLine } from "@shared/types/lyrics";

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe("默认引擎已排版发音", () => {
  it.each([false, true])("强调开关 %s 不改变连续音节或手工空格", (emphasize) => {
    const words = ["ho", "ri", "zon  ", "ni  hao"].map((word, i) => ({
      word,
      startTime: i * 2000 + 1000,
      endTime: (i + 1) * 2000 + 1000,
    }));
    const element = document.createElement("div");
    const renderer = new LyricRenderer(element, {
      enableEmphasizeEffect: emphasize,
      enableFloatAnimation: false,
      enableScrollPreroll: false,
    });
    try {
      renderer.setLyrics([
        {
          words,
          startTime: 1000,
          endTime: 9000,
          translatedLyric: "",
          romanLyric: "",
          isBG: false,
          isDuet: false,
          preserveWordSpacing: true,
        },
      ]);
      expect(element.querySelector(".lp-main")?.textContent).toBe("horizon  ni  hao");
      const internal = renderer as unknown as {
        wordMeasurements: { word: LyricLine["words"][number] }[][];
      };
      expect(
        internal.wordMeasurements[0].map(({ word }) => [word.startTime, word.endTime]),
      ).toEqual(words.map(({ startTime, endTime }) => [startTime, endTime]));
    } finally {
      renderer.dispose();
    }
  });
});
