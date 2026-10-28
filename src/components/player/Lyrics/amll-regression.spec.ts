import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mount, type VueWrapper } from "@vue/test-utils";
import { LayoutAlignAnchor, LayoutReason, LyricPlayer } from "@applemusic-like-lyrics/core";
import type { LyricLine } from "@shared/types/lyrics";
import AMLLLyrics from "./AMLLLyrics.vue";
import { promotePronunciation } from "./romanization";
import { SPlayerLyricPlayer } from "./amll-player";
import { getOverlapAlignPosition } from "@/utils/lyric/overlapAlign";
import { parseLyric } from "@/utils/lyric/parse";

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
let maskPadding = "0px";
let player: LyricPlayer | undefined;
let wrapper: VueWrapper | undefined;

beforeEach(() => {
  animations = [];
  maskPadding = "0px";
  const computedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    (element) =>
      new Proxy(computedStyle(element), {
        get(target, property) {
          if (property === "paddingLeft") return maskPadding;
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
  );
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
  it("遮罩绘制留白不计入正文与发音的推进宽度", () => {
    maskPadding = "8px";
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(56);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(56);
    player = new LyricPlayer();
    player.setOptimizeOptions({ normalizeSpaces: false, resetLineTimestamps: false });
    const hookedLine = { ...makeLine(), __amllIndependentMainWordMask: true };
    player.setLyricLines([hookedLine]);
    const line = player.currentLyricGroups[0].mainLine;
    line.show();
    animations = [];
    line.updateMaskImageSync();
    const masks = animations.filter(({ options }) => options.id?.startsWith("fade-word"));
    expect(masks).toHaveLength(4);
    // 40px 文字、两侧各 8px 留白、20px 渐变；留白不能被当成下一词的推进距离。
    for (const mask of [masks[0], masks[2]]) {
      expect(mask.frames[0].maskPosition).toBe("-76px 0");
      expect(mask.frames.at(-1)?.maskPosition).toBe("0px 0");
      expect(mask.options.duration).toBe(4000);
    }
  });

  it("ESM 与 CommonJS 的 hook 实现保持一致", () => {
    const cjsPath = createRequire(import.meta.url).resolve("@applemusic-like-lyrics/core");
    const cjs = readFileSync(cjsPath, "utf8");
    const esm = readFileSync(cjsPath.replace(/\.cjs$/, ".mjs"), "utf8");
    // 旧补丁两份产物曾有分歧，按完整消费方法校验，防止升级只迁移其中一份。
    for (const [start, end] of [
      ["\tcreateWord(", "\n\tbuildWord("],
      ["\tupdateMaskImageSync(", "\n\tgetElement("],
      ["\tcalcLayout(", "\n\tresolveIsActive("],
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
  it("暂停时切换强制分隔会从原歌词重建，关闭后恢复手工空格", async () => {
    const source = makeLine();
    source.words[0].romanWord = "ni  ";
    source.words[1].romanWord = "hao";
    source.words.push({ word: "吗", romanWord: "ma", startTime: 3000, endTime: 4000 });
    const setLines = vi.spyOn(LyricPlayer.prototype, "setLyricLines");
    wrapper = mount(AMLLLyrics, {
      props: { lyricLines: [source], playing: false, largerLyricText: "pronunciation" },
    });
    await vi.waitFor(() =>
      expect(wrapper!.find(".amll-lyrics-container").classes()).toContain("is-visible"),
    );
    const words = () => setLines.mock.calls.at(-1)?.[0][0].words.map((word) => word.word);
    expect(words()).toEqual(["ni  ", "hao", "ma"]);
    await wrapper.setProps({ forceSyllableSpacing: true });
    await vi.waitFor(() => expect(words()).toEqual(["ni ", "hao ", "ma"]));
    await wrapper.setProps({ forceSyllableSpacing: false });
    await vi.waitFor(() => expect(words()).toEqual(["ni  ", "hao", "ma"]));
    expect(source.words[0].romanWord).toBe("ni  ");
  });

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
  it.each(["top", "center", "bottom"] as const)(
    "呼吸点按 %s 锚点对齐，正常播放与 seek 一致",
    async (anchor) => {
      player = new LyricPlayer();
      player.setOptimizeOptions({ normalizeSpaces: false, resetLineTimestamps: false });
      player.setLyricLines([makeLine(0, 1000), makeLine(10000, 14000)]);
      player.size[1] = 800;
      player.setAlignPosition(0.35);
      player.setAlignAnchor(anchor as LayoutAlignAnchor);
      const calculator = (
        player as unknown as {
          layoutCalculator: { setLineHeight(index: number, height: number): void };
        }
      ).layoutCalculator;
      player.currentLyricGroups.forEach((_group, index) =>
        calculator.setLineHeight(index, index ? 240 : 120),
      );
      const internal = player as unknown as {
        layoutState: { interludeDotsSize: [number, number] };
        interludeDots: { setTransform(x: number, y: number): void };
      };
      internal.layoutState.interludeDotsSize = [80, 26];
      const dots = vi.spyOn(internal.interludeDots, "setTransform");
      player.setCurrentTime(500, true);
      player.setCurrentTime(1500);
      player.calcLayout(LayoutReason.ConfigChange);
      const expected = 280 - (anchor === "center" ? 13 : anchor === "bottom" ? 26 : 0);
      expect(dots.mock.calls.at(-1)?.[1]).toBeCloseTo(expected);
      player.setCurrentTime(1500, true);
      player.calcLayout(LayoutReason.ConfigChange);
      expect(dots.mock.calls.at(-1)?.[1]).toBeCloseTo(expected);
      player.setCurrentTime(10500);
      const count = dots.mock.calls.length;
      player.calcLayout(LayoutReason.ConfigChange);
      expect(dots).toHaveBeenCalledTimes(count);
    },
  );

  it("抬高跨过 0.4 时保持用户的居中锚点", async () => {
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(800);
    vi.spyOn(SPlayerLyricPlayer.prototype, "getBufferedMainLineCount").mockReturnValue(3);
    vi.spyOn(SPlayerLyricPlayer.prototype, "getBufferedMainLineMetrics").mockReturnValue({
      firstHeight: 80,
      secondHeight: 80,
      gap: 80,
      overlapDuration: 2000,
    });
    const align = vi.spyOn(LyricPlayer.prototype, "setAlignPosition");
    const anchor = vi.spyOn(LyricPlayer.prototype, "setAlignAnchor");
    wrapper = mount(AMLLLyrics, {
      props: {
        lyricLines: [makeLine()],
        playing: false,
        alignPosition: 0.45,
        raiseAlignPositionOnOverlap: true,
      },
    });
    await vi.waitFor(() =>
      expect(wrapper!.find(".amll-lyrics-container").classes()).toContain("is-visible"),
    );
    expect(align).toHaveBeenLastCalledWith(0.25);
    expect(anchor).toHaveBeenLastCalledWith("center");
    await wrapper.setProps({ raiseAlignPositionOnOverlap: false });
    expect(align).toHaveBeenLastCalledWith(0.45);
    expect(anchor).toHaveBeenLastCalledWith("center");
  });

  it.each([60, 1600])("第三行高度为 %i 时原地亮起，首行结束后才换用新的两行", (thirdHeight) => {
    const instance = new SPlayerLyricPlayer();
    player = instance;
    instance.setOptimizeOptions({ normalizeSpaces: false, resetLineTimestamps: false });
    instance.setLyricLines([makeLine(0, 8000), makeLine(2000, 9000), makeLine(4000, 10000)]);
    const calculator = (
      instance as unknown as {
        layoutCalculator: { setLineHeight(index: number, height: number): void };
      }
    ).layoutCalculator;
    instance.currentLyricGroups.forEach((_group, i) =>
      calculator.setLineHeight(i, [80, 120, thirdHeight][i]),
    );
    instance.setCurrentTime(2500, true);
    const two = instance.getBufferedMainLineMetrics()!;
    expect(two).toMatchObject({ firstHeight: 80, secondHeight: 120, gap: 0 });
    instance.setCurrentTime(4500);
    instance.advanceOverlapAnchor();
    const three = instance.getBufferedMainLineMetrics()!;
    expect(three).toEqual(two);
    const align = (metrics: typeof three) =>
      getOverlapAlignPosition(
        0.35,
        800,
        metrics.firstHeight,
        metrics.secondHeight,
        metrics.gap,
        metrics.overlapDuration,
      );
    expect(align(three)).toBe(align(two));
    instance.setCurrentTime(8500);
    instance.advanceOverlapAnchor();
    expect(instance.getBufferedMainLineCount()).toBe(2);
    expect(instance.getBufferedMainLineMetrics()).toMatchObject({
      firstHeight: 120,
      secondHeight: thirdHeight,
      gap: 0,
    });
    expect(
      (
        instance as unknown as { timelineController: { getSnapshot(): { scrollToIndex: number } } }
      ).timelineController.getSnapshot().scrollToIndex,
    ).toBe(1);
    instance.setCurrentTime(9500, true);
    expect(instance.getBufferedMainLineMetrics()).toBeNull();
  });

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

describe("AMLL 效果设置 hook", () => {
  it.each(["ESM", "CommonJS"])("%s 的禁用设置与上浮强度实际生效", (entry) => {
    const Player =
      entry === "ESM"
        ? LyricPlayer
        : (
            createRequire(import.meta.url)(
              "@applemusic-like-lyrics/core",
            ) as typeof import("@applemusic-like-lyrics/core")
          ).LyricPlayer;
    player = new Player();
    player.setOptimizeOptions({ normalizeSpaces: false, resetLineTimestamps: false });
    const disabled = {
      ...makeLine(),
      __amllDisableWordHighlight: true,
      __amllDisableEmphasize: true,
      __amllFloatAnimationIntensity: "extreme",
    };
    player.setLyricLines([disabled]);
    player.currentLyricGroups[0].mainLine.show();
    expect(animations.filter(({ options }) => options.id?.startsWith("fade-word"))).toHaveLength(0);
    expect(animations.filter(({ options }) => options.id?.startsWith("emphasize"))).toHaveLength(0);
    const floating = animations.filter(({ options }) => options.id === "float-word");
    expect(floating).toHaveLength(2);
    expect(floating.every(({ frames }) => frames.at(-1)?.transform === "translateY(-0.15em)")).toBe(
      true,
    );
    const cjkDisabled = { ...makeLine(), __amllDisableCjkEmphasis: true };
    player.setLyricLines([cjkDisabled]);
    animations = [];
    player.currentLyricGroups[0].mainLine.show();
    expect(animations.some(({ options }) => options.id?.startsWith("fade-word"))).toBe(true);
    expect(animations.some(({ options }) => options.id?.startsWith("emphasize"))).toBe(false);
  });
});

describe.each(["ESM", "CommonJS"] as const)("%s 的 AMLL 高亮", (entry) => {
  it.each(["ttml", "lrcn", "qrc"] as const)(
    "%s 解析后不会点亮两条重叠主行之间已经结束的行",
    (format) => {
      const Player =
        entry === "ESM"
          ? LyricPlayer
          : (
              createRequire(import.meta.url)(
                "@applemusic-like-lyrics/core",
              ) as typeof import("@applemusic-like-lyrics/core")
            ).LyricPlayer;
      player = new Player();
      player.setOptimizeOptions({
        normalizeSpaces: false,
        resetLineTimestamps: false,
        cleanUnintentionalOverlaps: false,
        tryAdvanceStartTime: false,
      });
      const ranges = [
        [0, 15000],
        [1000, 2000],
        [3000, 4000],
        [6000, 8000],
      ];
      const contents = {
        ttml:
          '<tt xmlns="http://www.w3.org/ns/ttml"><body><div>' +
          ranges
            .map(
              ([start, end], index) =>
                '<p begin="' +
                start / 1000 +
                's" end="' +
                end / 1000 +
                's" agent="v' +
                ((index % 2) + 1) +
                '"><span begin="' +
                start / 1000 +
                's" end="' +
                end / 1000 +
                's">歌词</span></p>',
            )
            .join("") +
          "</div></body></tt>",
        lrcn:
          "[Lyrics Next]\n" +
          ranges
            .map(
              ([start, end], index) =>
                "[" +
                start / 1000 +
                "," +
                end / 1000 +
                ",v" +
                ((index % 2) + 1) +
                "]<" +
                start / 1000 +
                "," +
                end / 1000 +
                ">歌词",
            )
            .join("\n"),
        qrc: ranges
          .map(
            ([start, end]) =>
              "[" + start + "," + (end - start) + "]歌词(" + start + "," + (end - start) + ")",
          )
          .join("\n"),
      };
      player.setLyricLines(parseLyric({ content: contents[format] }, format));
      player.setCurrentTime(1500, true);
      expect(
        player.currentLyricGroups.map(
          (group) => (group as unknown as { isActive: boolean }).isActive,
        ),
      ).toEqual([true, true, false, false]);
      player.setCurrentTime(3500);
      player.setCurrentTime(6500);
      expect(
        player.currentLyricGroups.map(
          (group) => (group as unknown as { isActive: boolean }).isActive,
        ),
      ).toEqual([true, false, false, true]);
      player.setCurrentTime(6500, true);
      expect(
        player.currentLyricGroups.map(
          (group) => (group as unknown as { isActive: boolean }).isActive,
        ),
      ).toEqual([true, false, false, true]);
      player.setCurrentTime(1500, true);
      expect(
        player.currentLyricGroups.map(
          (group) => (group as unknown as { isActive: boolean }).isActive,
        ),
      ).toEqual([true, true, false, false]);
    },
  );

  it("切换歌曲后不会保留上一首的高亮行", () => {
    const Player =
      entry === "ESM"
        ? LyricPlayer
        : (
            createRequire(import.meta.url)(
              "@applemusic-like-lyrics/core",
            ) as typeof import("@applemusic-like-lyrics/core")
          ).LyricPlayer;
    player = new Player();
    player.setOptimizeOptions({ normalizeSpaces: false, resetLineTimestamps: false });
    player.setLyricLines([makeLine(0, 15000), makeLine(1000, 2000), makeLine(6000, 8000)]);
    player.setCurrentTime(6500, true);
    player.setLyricLines([makeLine(0, 1000), makeLine(6000, 8000)]);
    player.setCurrentTime(6500, true);
    expect(
      player.currentLyricGroups.map(
        (group) => (group as unknown as { isActive: boolean }).isActive,
      ),
    ).toEqual([false, true]);
    player.setCurrentTime(500, true);
    expect(
      player.currentLyricGroups.map(
        (group) => (group as unknown as { isActive: boolean }).isActive,
      ),
    ).toEqual([true, false]);
  });
});
