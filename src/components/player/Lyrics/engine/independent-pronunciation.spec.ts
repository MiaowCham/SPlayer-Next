import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LyricRenderer } from "lyric-dom";
import type { LyricLine } from "@shared/types/lyrics";

let renderer: LyricRenderer | undefined;
let container: HTMLDivElement;
let romanWidth = 176;

const line: LyricLine = {
  startTime: 1000,
  endTime: 5000,
  words: [
    {
      word: "長",
      romanWord: "nagai",
      startTime: 1000,
      endTime: 3000,
      ruby: [{ word: "なが", startTime: 1000, endTime: 3000 }],
    },
    { word: "い", startTime: 3000, endTime: 5000 },
  ],
  translatedLyric: "长",
  romanLyric: "",
  isBG: false,
  isDuet: false,
};

beforeEach(() => {
  romanWidth = 176;
  container = document.createElement("div");
  document.body.append(container);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const getStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const style = getStyle(element);
    const padding = element.classList.contains("lp-roman-word") ? "16px" : "32px";
    return new Proxy(style, {
      get(target, key) {
        if (["paddingLeft", "paddingRight", "paddingTop", "paddingBottom"].includes(String(key)))
          return padding;
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("lp-roman-word") ? romanWidth : 96;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(96);
});

afterEach(() => {
  renderer?.dispose();
  renderer = undefined;
  container.remove();
  vi.unstubAllGlobals();
});

describe("默认引擎独立发音遮罩 Hook", () => {
  it.each([false, true])("普通词与强调词分别测量两层，强调=%s", (emphasize) => {
    renderer = new LyricRenderer(container, {
      playing: false,
      wordFadeWidth: 0,
      showWordRomanization: true,
      independentWordRomanizationProgress: true,
      enableFloatAnimation: false,
      enableEmphasizeEffect: emphasize,
      showRuby: true,
      enableScrollPreroll: false,
    });
    renderer.setLyrics([line]);
    renderer.setConfig({ wordFadeWidth: 0.5 });
    const word = container.querySelector<HTMLElement>(".lp-word-roman")!;
    const [main, roman] = Array.from(word.children) as HTMLElement[];
    expect(word.style.maskImage).toBe("");
    expect(main.style.maskImage).toContain("linear-gradient");
    expect(roman.style.maskImage).toContain("linear-gradient");
    expect(main.style.maskSize).not.toBe(roman.style.maskSize);
    expect(main.style.maskPosition).not.toBe(roman.style.maskPosition);
    expect(main.style.maskPosition).toContain("var(--t,1000)");
    expect(roman.style.maskPosition).toContain("var(--t,1000)");
    expect(roman.textContent).toContain("nagai");
    if (!emphasize)
      expect(container.querySelectorAll(".lp-roman-word")[1]?.textContent).toBe("\u00a0");
    else expect(main.textContent).toContain("い");
    expect(line.words[0].ruby?.[0].word).toBe("なが");
  });

  it("暂停、冻结与热切换不重建词节点，关闭后还原父遮罩", () => {
    renderer = new LyricRenderer(container, {
      playing: false,
      wordFadeWidth: 0,
      showWordRomanization: true,
      enableFloatAnimation: false,
      enableEmphasizeEffect: false,
      enableScrollPreroll: false,
    });
    renderer.setLyrics([line]);
    renderer.setConfig({ wordFadeWidth: 0.4 });
    const word = container.querySelector<HTMLElement>(".lp-word-roman")!;
    const main = word.firstElementChild as HTMLElement;
    expect(word.style.maskImage).toContain("gradient");
    renderer.freeze();
    renderer.setConfig({ independentWordRomanizationProgress: true });
    expect(container.querySelector(".lp-word-roman")).toBe(word);
    expect(word.style.maskImage).toBe("");
    expect(main.style.maskImage).toContain("gradient");
    renderer.resume();
    renderer.setConfig({ independentWordRomanizationProgress: false });
    expect(word.style.maskImage).toContain("gradient");
    expect(main.style.maskImage).toBe("");
    expect(container.classList.contains("lp-independent-word-masks")).toBe(false);
  });

  it("尺寸更新只重测发音层，不改变正文层进度几何，销毁后清理 Hook", () => {
    renderer = new LyricRenderer(container, {
      playing: false,
      wordFadeWidth: 0,
      showWordRomanization: true,
      independentWordRomanizationProgress: true,
      enableFloatAnimation: false,
      enableEmphasizeEffect: false,
    });
    renderer.setLyrics([line]);
    renderer.setConfig({ wordFadeWidth: 0.5 });
    const main = container.querySelector<HTMLElement>(".lp-word-text")!;
    const roman = container.querySelector<HTMLElement>(".lp-roman-word")!;
    const originalMain = main.style.maskPosition;
    const originalRoman = roman.style.maskPosition;
    romanWidth = 240;
    renderer.setConfig({ alignment: "right" });
    expect(main.style.maskPosition).toBe(originalMain);
    expect(roman.style.maskPosition).not.toBe(originalRoman);
    renderer.dispose();
    expect(container.children).toHaveLength(0);
    expect(container.classList.contains("lp-independent-word-masks")).toBe(false);
    renderer = undefined;
  });
});
