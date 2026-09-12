import { describe, expect, it } from "vitest";
import { buildWordSpans } from "./word-builder";

describe("默认引擎已排版发音", () => {
  it.each([false, true])("强调开关 %s 不改变连续音节或手工空格", (emphasize) => {
    const words = ["ho", "ri", "zon  ", "ni  hao"].map((word, i) => ({
      word,
      startTime: i * 2000,
      endTime: (i + 1) * 2000,
    }));
    const element = document.createElement("div");
    const result = buildWordSpans(words, element, emphasize, false, true);
    expect(element.textContent).toBe("horizon  ni  hao");
    expect(element.style.whiteSpace).toBe("pre-wrap");
    expect(result.measurements.map(({ word }) => [word.startTime, word.endTime])).toEqual(
      words.map((word) => [word.startTime, word.endTime]),
    );
  });
});
