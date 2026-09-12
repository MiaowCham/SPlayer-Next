import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mount, type VueWrapper } from "@vue/test-utils";
import { LyricPlayer } from "@applemusic-like-lyrics/core";
import type { LyricLine } from "@shared/types/lyrics";
import AMLLLyrics from "./AMLLLyrics.vue";
import { promotePronunciation } from "./romanization";

vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({
    lyric: {
      useAMSpring: false,
      amllCleanUnintentionalOverlaps: false,
      amllTryAdvanceStartTime: false,
      amllConvertExcessiveBackgroundLines: false,
      amllSyncMainAndBackgroundLines: false,
      amllNormalizeSpaces: false,
      amllResetLineTimestamps: false,
    },
  }),
}));
vi.mock("@/stores/status", () => ({ useStatusStore: () => ({ lyricOffsetMs: 0 }) }));
vi.mock("@/services/playback", () => ({ getCurrentTime: () => 0 }));

const makeLine = (startTime = 0, endTime = 4000): LyricLine => ({
  startTime,
  endTime,
  words: [
    { word: "你", romanWord: "ni", startTime, endTime: startTime + 1000 },
    { word: "好", romanWord: "hao", startTime: startTime + 1000, endTime },
  ],
  translatedLyric: "",
  romanLyric: "",
  isBG: false,
  isDuet: false,
});

type RecordedAnimation = {
  element: Element;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
  animation: Animation;
};
let animations: RecordedAnimation[] = [];
let player: LyricPlayer | undefined;
let wrapper: VueWrapper | undefined;

beforeEach(() => {
  animations = [];
  vi.spyOn(CSSStyleDeclaration.prototype, "paddingLeft", "get").mockReturnValue("0px");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(CSS, "supports").mockReturnValue(true);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("amll-roman-mask") ? (this.textContent?.length ?? 0) * 12 : 40;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("amll-roman-mask") ? 20 : 40;
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.stubGlobal("Animation", class {});
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: function (frames: Keyframe[], options: KeyframeAnimationOptions) {
      const animation = {
        id: options.id ?? "",
        currentTime: 0,
        playbackRate: 1,
        playState: "paused",
        effect: { getComputedTiming: () => options },
        pause: vi.fn(),
        play: vi.fn(),
        cancel: vi.fn(),
        finish: vi.fn(),
      } as unknown as Animation;
      animations.push({ element: this, frames, options, animation });
      return animation;
    },
  });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  player?.dispose();
  player = undefined;
  delete (Element.prototype as Partial<Element>).animate;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("AMLL 独立发音遮罩", () => {
  it("ESM 与 CommonJS 的 hook 实现保持一致", () => {
    const cjsPath = createRequire(import.meta.url).resolve("@applemusic-like-lyrics/core");
    const cjs = readFileSync(cjsPath, "utf8");
    const esm = readFileSync(cjsPath.replace(/\.cjs$/, ".mjs"), "utf8");
    // 旧补丁两份产物曾有分歧，按完整消费方法校验，防止升级只迁移其中一份。
    for (const [start, end] of [
      ["\tcreateWord(", "\n\tbuildWord("],
      ["\tupdateMaskImageSync(", "\n\tgetElement("],
      ["function normalizeSpaces(", "function resetLineTimestamps("],
      ["function chunkAndSplitLyricWords(", "//#endregion"],
    ]) {
      const esmStart = esm.indexOf(start);
      const cjsStart = cjs.indexOf(start);
      expect(esmStart).toBeGreaterThan(-1);
      expect(cjsStart).toBeGreaterThan(-1);
      expect(cjs.slice(cjsStart, cjs.indexOf(end, cjsStart))).toBe(
        esm.slice(esmStart, esm.indexOf(end, esmStart)),
      );
    }
  });

  it("保留 ruby 分段和缺失发音的正文", () => {
    player = new LyricPlayer();
    const data = makeLine();
    data.words[0].ruby = [
      { word: "n", startTime: 0, endTime: 400 },
      { word: "i", startTime: 400, endTime: 1000 },
    ];
    delete data.words[1].romanWord;
    player.setOptimizeOptions({ normalizeSpaces: false, resetLineTimestamps: false });
    const hookedLine = { ...data, __amllIndependentRomanWordMask: true };
    player.setLyricLines([hookedLine]);
    const line = player.currentLyricGroups[0].mainLine;
    line.show();
    animations = [];
    line.updateMaskImageSync();
    expect(line.getElement().querySelectorAll("[data-start-time]")).toHaveLength(2);
    expect(line.getElement().textContent).toContain("好");
    const masks = animations.filter(({ options }) => options.id?.startsWith("fade-word"));
    expect(masks).toHaveLength(4);
    expect(masks[0].frames.some((frame) => frame.offset === 0.1)).toBe(true);
    player.dispose();
    player = undefined;
    for (const { animation } of masks) expect(animation.cancel).toHaveBeenCalled();
  });

  it("零时长歌词不产生无效动画偏移", () => {
    player = new LyricPlayer();
    const lineData = makeLine(0, 0);
    lineData.words = lineData.words.map((word) => ({ ...word, startTime: 0, endTime: 0 }));
    player.setOptimizeOptions({ normalizeSpaces: false, resetLineTimestamps: false });
    const hookedLine = { ...lineData, __amllIndependentRomanWordMask: true };
    player.setLyricLines([hookedLine]);
    const line = player.currentLyricGroups[0].mainLine;
    line.show();
    animations = [];
    line.updateMaskImageSync();
    const masks = animations.filter(({ options }) => options.id?.startsWith("fade-word"));
    expect(masks).toHaveLength(4);
    for (const { frames } of masks) {
      expect(frames.every((frame) => Number.isFinite(frame.offset))).toBe(true);
    }
  });

  it.each(["__amllIndependentRomanWordMask", "__amllIndependentMainWordMask"])(
    "%s 使用独立尺寸并保持行级连续时间轴",
    (flag) => {
      player = new LyricPlayer();
      player.setOptimizeOptions({ normalizeSpaces: false, resetLineTimestamps: false });
      player.setLyricLines([{ ...makeLine(), [flag]: true }]);
      const line = player.currentLyricGroups[0].mainLine;
      line.show();
      animations = [];
      line.updateMaskImageSync();

      const masks = animations.filter(({ options }) => options.id?.startsWith("fade-word"));
      expect(masks).toHaveLength(4);
      expect(
        masks.filter(({ element }) => element.classList.contains("amll-main-mask")),
      ).toHaveLength(2);
      const romanMasks = masks.filter(({ element }) =>
        element.classList.contains("amll-roman-mask"),
      );
      expect(romanMasks).toHaveLength(2);
      expect(masks[0].frames).not.toEqual(romanMasks[0].frames);
      for (const { frames, options } of masks) {
        expect(options.duration).toBe(4000);
        const offsets = frames.map((frame) => frame.offset as number);
        expect(offsets.every(Number.isFinite)).toBe(true);
        expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
        expect(frames.at(-1)?.maskPosition).toBe("0px 0");
      }
      const firstRoman = romanMasks[0];
      const atWordEnd = firstRoman.frames.find((frame) => frame.offset === 0.25);
      expect(Number.parseFloat(String(atWordEnd?.maskPosition))).toBeLessThan(0);
      const oldMasks = [...masks];
      line.updateMaskImageSync();
      for (const { animation } of oldMasks) expect(animation.cancel).toHaveBeenCalled();
      player.setCurrentTime(1500, true);
      player.pause();
      const latestMasks = animations
        .filter(({ options }) => options.id?.startsWith("fade-word"))
        .slice(-4);
      for (const { animation } of latestMasks) {
        expect(animation.currentTime).toBe(1500);
        expect(animation.pause).toHaveBeenCalled();
      }
    },
  );

  it("关闭设置时保留原始词容器与单层遮罩", () => {
    player = new LyricPlayer();
    document.body.appendChild(player.getElement());
    player.setLyricLines([makeLine()]);
    const line = player.currentLyricGroups[0].mainLine;
    line.show();
    expect(line.getElement().querySelector(".amll-main-mask")).toBeNull();
    expect(line.getElement().querySelector(".amll-roman-mask")).toBeNull();
    animations = [];
    line.updateMaskImageSync();
    expect(animations.filter(({ options }) => options.id?.startsWith("fade-word"))).toHaveLength(2);
  });
});

describe("AMLL 发音空格 hook", () => {
  it("开启上游空格标准化后仍保留作者分隔与音节完整时间", () => {
    player = new LyricPlayer();
    const source = makeLine();
    source.words[0].romanWord = "ni  hao  ";
    source.words[1].romanWord = "ya";
    player.setOptimizeOptions({ normalizeSpaces: true, resetLineTimestamps: false });
    player.setLyricLines([promotePronunciation(source, "word")]);
    const line = player.currentLyricGroups[0].mainLine;
    line.show();
    expect(line.getLine().words[0].word).toBe("ni  hao  ");
    const timed = (line as unknown as { splittedWords: LyricLine["words"] }).splittedWords;
    expect(timed).toHaveLength(2);
    expect(timed.map(({ startTime, endTime }) => [startTime, endTime])).toEqual([
      [0, 1000],
      [1000, 4000],
    ]);
    expect(line.getElement().textContent).toContain("ni  hao");
    const spaces = Array.from(line.getElement().querySelectorAll("*")).flatMap((el) =>
      Array.from(el.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent),
    );
    expect(spaces).toContain("  ");
  });
});

describe("AMLL 多行同亮抬高", () => {
  it("暂停时切换立即布局，并随重叠开始和结束恢复对齐点", async () => {
    const align = vi.spyOn(LyricPlayer.prototype, "setAlignPosition");
    const layout = vi.spyOn(LyricPlayer.prototype, "calcLayout");
    wrapper = mount(AMLLLyrics, {
      props: {
        lyricLines: [makeLine(), makeLine(2000, 6000), makeLine(6000, 9000)],
        playing: false,
        alignPosition: 0.35,
      },
    });
    await vi.waitFor(() =>
      expect(wrapper!.find(".amll-lyrics-container").classes()).toContain("is-visible"),
    );
    const exposed = wrapper.vm as unknown as { setCurrentTime(time: number, seek?: boolean): void };
    exposed.setCurrentTime(2500, true);
    await wrapper.setProps({ raiseAlignPositionOnOverlap: true });
    expect(align).toHaveBeenLastCalledWith(0.35);
    expect(layout).toHaveBeenCalled();
    exposed.setCurrentTime(4500);
    expect(align).toHaveBeenLastCalledWith(0.35);
    exposed.setCurrentTime(6500);
    expect(align).toHaveBeenLastCalledWith(0.35);
    exposed.setCurrentTime(4500, true);
    expect(align).toHaveBeenLastCalledWith(0.35);
    exposed.setCurrentTime(2500, true);
    expect(align).toHaveBeenLastCalledWith(0.35);
    await wrapper.setProps({ raiseAlignPositionOnOverlap: false });
    expect(align).toHaveBeenLastCalledWith(0.35);
  });
});
