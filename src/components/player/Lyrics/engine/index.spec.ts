import { afterEach, describe, expect, it, vi } from "vitest";
import type { LyricLine } from "@shared/types/lyrics";
import { LyricRenderer } from "./index";
import { prepareLyricDisplayLines } from "../display-timing";
import { applyScrollPreroll } from "../utils/scroll-preroll";

const line = (word: string, startTime: number, endTime: number, isBG = false): LyricLine => ({
  words: [{ word, startTime, endTime }],
  translatedLyric: "",
  romanLyric: "",
  startTime,
  endTime,
  isBG,
  isDuet: false,
});

const renderers: LyricRenderer[] = [];

const createRenderer = (
  lines: LyricLine[],
  config: ConstructorParameters<typeof LyricRenderer>[1] = {},
): { container: HTMLDivElement; renderer: LyricRenderer } => {
  const container = document.createElement("div");
  Object.defineProperties(container, {
    clientWidth: { configurable: true, value: 800 },
    clientHeight: { configurable: true, value: 600 },
  });
  document.body.appendChild(container);
  const renderer = new LyricRenderer(container, config);
  renderers.push(renderer);
  renderer.setLyrics(lines);
  return { container, renderer };
};

const activeTexts = (container: HTMLElement): string[] =>
  [...container.querySelectorAll<HTMLElement>(".lp-line.active")].map(
    (element) => element.textContent ?? "",
  );

const scrollTargetIndex = (renderer: LyricRenderer): number =>
  (renderer as unknown as { activeLineIndex: number }).activeLineIndex;

const linePosition = (renderer: LyricRenderer, index: number): number =>
  (
    renderer as unknown as {
      positionSprings: Array<{ getCurrentPosition: () => number }>;
    }
  ).positionSprings[index].getCurrentPosition();

afterEach(() => {
  for (const renderer of renderers.splice(0)) renderer.dispose();
  document.body.replaceChildren();
});

describe("LyricRenderer 显示时间线", () => {
  it("最大行数会结束最早主行，seek 后也不会重新高亮", () => {
    const { container, renderer } = createRenderer(
      [line("A", 0, 10000), line("B", 2000, 5000), line("C", 3000, 4000)],
      { maxHighlightedLines: 2, lineSelectionPreference: "early-end" },
    );

    renderer.scrollToTime(3000);
    expect(activeTexts(container)).toEqual(["B", "C"]);
    renderer.scrollToTime(4500);
    expect(activeTexts(container)).toEqual(["B"]);
  });

  it("中间行已结束时第三行仍会把更早长句移出高亮窗口", () => {
    const { container, renderer } = createRenderer(
      [line("A", 0, 10000), line("B", 1000, 2000), line("C", 3000, 4000)],
      { maxHighlightedLines: 2, lineSelectionPreference: "early-end" },
    );

    renderer.scrollToTime(3000);
    expect(activeTexts(container)).toEqual(["C"]);
  });

  it("默认模式保留重叠结束行，提早模式立即熄灭", () => {
    const { container, renderer } = createRenderer([line("A", 0, 3000), line("B", 1000, 5000)]);

    renderer.scrollToTime(3100);
    expect(activeTexts(container)).toEqual(["A", "B"]);
    renderer.setConfig({ lineSelectionPreference: "early-end" });
    expect(activeTexts(container)).toEqual(["B"]);
  });

  it("背景行随主行高亮但不单独占用上限", () => {
    const { container, renderer } = createRenderer(
      [line("A", 0, 5000), line("BG", 100, 4800, true), line("B", 1000, 4000)],
      { maxHighlightedLines: 2, lineSelectionPreference: "early-end" },
    );

    renderer.scrollToTime(1500);
    expect(activeTexts(container)).toEqual(["A", "BG", "B"]);
  });

  it("多行同亮阈值会在下一主句开始时结束短重叠前句", () => {
    const { container, renderer } = createRenderer([line("A", 0, 1490), line("B", 1000, 2000)], {
      multiLineOverlapThreshold: 490,
      earlyEndMode: "aggressive",
      lineSelectionPreference: "early-end",
    });

    renderer.scrollToTime(1000);
    expect(activeTexts(container)).toEqual(["B"]);
  });

  it("长间奏在预滚边界前保持上一行锚点", () => {
    const { renderer } = createRenderer(
      applyScrollPreroll([line("A", 0, 1000), line("B", 10000, 11000)]),
    );

    renderer.scrollToTime(9399);
    expect(scrollTargetIndex(renderer)).toBe(0);
    renderer.scrollToTime(9400);
    expect(scrollTargetIndex(renderer)).toBe(1);
  });

  it("启用提早结束后在有效结束点立即滚到下一行", () => {
    const lines = applyScrollPreroll(
      prepareLyricDisplayLines([line("A", 0, 1000), line("B", 10000, 11000)], "aggressive", {
        gapThresholdMs: 1300,
        advanceMs: 1000,
        scrollLeadMs: 400,
      }),
    );
    const { container, renderer } = createRenderer(lines);

    renderer.scrollToTime(9599);
    expect(scrollTargetIndex(renderer)).toBe(0);
    renderer.scrollToTime(9600);
    expect(scrollTargetIndex(renderer)).toBe(1);
    expect(activeTexts(container)).toEqual(["B"]);
  });

  it("提前选择下一行时取消级联延迟并立即启动滚动", () => {
    const lines = applyScrollPreroll(
      prepareLyricDisplayLines([line("A", 0, 1000), line("B", 10000, 11000)], "aggressive", {
        gapThresholdMs: 1300,
        advanceMs: 1000,
        scrollLeadMs: 400,
      }),
    );
    const { renderer } = createRenderer(lines);
    renderer.scrollToTime(9599);
    const internal = renderer as unknown as {
      processTime: (time: number) => boolean;
      calculateLayout: (syncImmediate: boolean, noCascade?: boolean) => void;
    };
    const layoutSpy = vi.spyOn(internal, "calculateLayout");

    internal.processTime(9600);

    expect(layoutSpy).toHaveBeenCalledWith(false, true);
  });

  it("重叠段使用 0.15，进入独立句后恢复用户对齐位置", () => {
    const { renderer } = createRenderer(
      [line("A", 0, 3000), line("B", 1000, 4000), line("C", 5000, 6000)],
      { alignPosition: 0.3, raiseAlignPositionOnOverlap: true },
    );

    renderer.scrollToTime(1500);
    expect(linePosition(renderer, 0)).toBe(70);
    renderer.scrollToTime(5000);
    expect(linePosition(renderer, 2)).toBe(160);
  });

  it("用户对齐位置低于 0.15 时不抬高", () => {
    const { renderer } = createRenderer([line("A", 0, 3000), line("B", 1000, 4000)], {
      alignPosition: 0.1,
      raiseAlignPositionOnOverlap: true,
    });

    renderer.scrollToTime(500);
    expect(linePosition(renderer, 0)).toBe(40);
  });
});
