import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import type { LyricLine } from "@shared/types/lyrics";
import AMLLLyrics from "./AMLLLyrics.vue";
import { prepareLyricDisplayLines } from "./display-timing";

vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({
    lyric: {
      useAMSpring: true,
      amllVerticalSpringMass: 0.5,
      amllVerticalSpringDamping: 10,
      amllVerticalSpringStiffness: 100,
      amllVerticalSpringSoft: false,
      amllScaleSpringMass: 0.5,
      amllScaleSpringDamping: 10,
      amllScaleSpringStiffness: 100,
      amllScaleSpringSoft: false,
    },
  }),
}));

vi.mock("@/stores/status", () => ({
  useStatusStore: () => ({ lyricOffsetMs: 0 }),
}));

vi.mock("@/services/playback", () => ({ getCurrentTime: () => 0 }));

const line = (word: string, startTime: number, endTime: number, isBG = false): LyricLine => ({
  words: [{ word, startTime, endTime }],
  translatedLyric: "",
  romanLyric: "",
  startTime,
  endTime,
  isBG,
  isDuet: false,
});

type ExposedAmlPlayer = {
  setCurrentTime: (time: number, isSeek?: boolean) => void;
  scrollToTime: (time: number) => void;
  lyricPlayer: {
    timelineState: {
      bufferedGroups: Set<number>;
      hotGroups: Set<number>;
      scrollToIndex: number;
    };
    layoutState: { alignPosition: number };
    currentLyricGroups: Array<{
      startTime: number;
      endTime: number;
      enable: (...args: unknown[]) => void;
      disable: () => void;
      mainLine: {
        getLine: () => LyricLine;
        getIndependentMaskEndTime: (
          word: { startTime: number; endTime: number },
          nextWord: { startTime: number; endTime: number } | undefined,
          fadeWidth: number,
          nextWidth: number,
        ) => number;
        getIndependentMaskPosition: (
          word: { startTime: number; endTime: number },
          width: number,
          fadeWidth: number,
          endTime: number,
        ) => string;
        createIndependentMaskAnimation: (
          element: HTMLElement,
          word: { word: string; startTime: number; endTime: number },
          width: number,
          height: number,
          id: string,
          endTime: number,
        ) => Animation;
      };
    }>;
    calcLayout: (...args: unknown[]) => void;
  };
};

const wrappers: VueWrapper[] = [];

const mountLyrics = (props: InstanceType<typeof AMLLLyrics>["$props"]): ExposedAmlPlayer => {
  const wrapper = mount(AMLLLyrics, {
    props,
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  return wrapper.vm as unknown as ExposedAmlPlayer;
};

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  document.body.replaceChildren();
});

describe("AMLLLyrics 显示时间线", () => {
  it("独立发音遮罩保留主体时长并按下一音节宽度延伸渐变尾部", () => {
    const component = mountLyrics({
      lyricLines: [line("A", 0, 1000)],
      independentWordRomanizationProgress: true,
    });
    const lineElement = component.lyricPlayer.currentLyricGroups[0].mainLine;
    const current = { startTime: 0, endTime: 1000 };
    const next = { startTime: 1000, endTime: 1600 };
    const endTime = lineElement.getIndependentMaskEndTime(current, next, 30, 120);
    const position = lineElement.getIndependentMaskPosition(current, 100, 30, endTime);

    expect(endTime).toBe(1150);
    expect(position).toContain("var(--amll-player-time) - 1000");
    expect(position).toContain("-30px");
    expect(position.match(/clamp\(/g)).toHaveLength(2);
  });

  it("独立发音遮罩最后一词不会延伸到歌词行外", () => {
    const component = mountLyrics({
      lyricLines: [line("A", 0, 1000)],
      independentWordRomanizationProgress: true,
    });
    const lineElement = component.lyricPlayer.currentLyricGroups[0].mainLine;

    expect(
      lineElement.getIndependentMaskEndTime({ startTime: 0, endTime: 1000 }, undefined, 30, 0),
    ).toBe(1000);
    expect(
      lineElement.getIndependentMaskEndTime(
        { startTime: 0, endTime: 1000 },
        { startTime: 1000, endTime: 1600 },
        0,
        120,
      ),
    ).toBe(1000);
    expect(
      lineElement.getIndependentMaskEndTime(
        { startTime: 0, endTime: 1000 },
        { startTime: 1000, endTime: 1600 },
        30,
        0,
      ),
    ).toBe(1000);
  });

  it("独立发音 Web Animation 在主体结束后仅推进渐变尾部", () => {
    const component = mountLyrics({
      lyricLines: [line("A", 0, 1000)],
      independentWordRomanizationProgress: true,
    });
    const lineElement = component.lyricPlayer.currentLyricGroups[0].mainLine;
    const element = document.createElement("span");
    const pause = vi.fn();
    const animate = vi.fn().mockReturnValue({ pause });
    Object.defineProperty(element, "animate", { configurable: true, value: animate });

    lineElement.createIndependentMaskAnimation(
      element,
      { word: "A", startTime: 0, endTime: 1000 },
      100,
      60,
      "independent-mask",
      1150,
    );

    expect(animate).toHaveBeenCalledWith(
      [
        { maskPosition: "-130px 0", offset: 0 },
        { maskPosition: "-30px 0", offset: 1000 / 1150 },
        { maskPosition: "0px 0", offset: 1 },
      ],
      {
        duration: 1150,
        delay: 0,
        easing: "linear",
        id: "independent-mask",
        fill: "both",
      },
    );
    expect(pause).toHaveBeenCalledOnce();
  });

  it("最大行数限制与默认引擎保持一致", () => {
    const component = mountLyrics({
      lyricLines: [line("A", 0, 10000), line("B", 2000, 5000), line("C", 3000, 4000)],
      maxHighlightedLines: 2,
      lineSelectionPreference: "early-end",
    });

    component.scrollToTime(3000);
    expect([...component.lyricPlayer.timelineState.bufferedGroups]).toEqual([1, 2]);
    component.scrollToTime(4500);
    expect([...component.lyricPlayer.timelineState.bufferedGroups]).toEqual([1]);
  });

  it("多行同亮阈值与默认引擎保持一致", () => {
    const component = mountLyrics({
      lyricLines: [line("A", 0, 1490), line("B", 1000, 2000)],
      multiLineOverlapThreshold: 490,
      earlyEndMode: "aggressive",
      lineSelectionPreference: "early-end",
    });

    component.scrollToTime(1000);
    expect([...component.lyricPlayer.timelineState.bufferedGroups]).toEqual([1]);
  });

  it("中间行已结束时第三行仍会把更早长句移出高亮窗口", () => {
    const component = mountLyrics({
      lyricLines: [line("A", 0, 10000), line("B", 1000, 2000), line("C", 3000, 4000)],
      maxHighlightedLines: 2,
      lineSelectionPreference: "early-end",
    });

    component.scrollToTime(3000);
    expect([...component.lyricPlayer.timelineState.bufferedGroups]).toEqual([2]);
  });

  it("运行时提高上限不会让已强制结束的组重新亮起", async () => {
    const wrapper = mount(AMLLLyrics, {
      props: {
        lyricLines: [line("A", 0, 5000), line("B", 1000, 5000), line("C", 2000, 5000)],
        maxHighlightedLines: 2,
        lineSelectionPreference: "early-end",
      },
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    const component = wrapper.vm as unknown as ExposedAmlPlayer;

    component.scrollToTime(2500);
    expect([...component.lyricPlayer.timelineState.bufferedGroups]).toEqual([1, 2]);
    await wrapper.setProps({ maxHighlightedLines: 3 });
    expect([...component.lyricPlayer.timelineState.bufferedGroups]).toEqual([1, 2]);
  });

  it("强制结束后连续时间推送不会反复启用和禁用旧组", () => {
    const component = mountLyrics({
      lyricLines: [line("A", 0, 10000), line("B", 2000, 5000), line("C", 3000, 4000)],
      maxHighlightedLines: 2,
      lineSelectionPreference: "early-end",
    });
    const firstGroup = component.lyricPlayer.currentLyricGroups[0];
    const enableSpy = vi.spyOn(firstGroup, "enable");
    const disableSpy = vi.spyOn(firstGroup, "disable");
    const layoutSpy = vi.spyOn(component.lyricPlayer, "calcLayout");

    component.setCurrentTime(3000);
    const countsAfterOverflow = {
      enable: enableSpy.mock.calls.length,
      disable: disableSpy.mock.calls.length,
      layout: layoutSpy.mock.calls.length,
    };
    component.setCurrentTime(3100);
    component.setCurrentTime(3200);
    expect(enableSpy).toHaveBeenCalledTimes(countsAfterOverflow.enable);
    expect(disableSpy).toHaveBeenCalledTimes(countsAfterOverflow.disable);
    expect(layoutSpy).toHaveBeenCalledTimes(countsAfterOverflow.layout);
  });

  it("Core 分组与统一处理后的连续背景行保持一致", () => {
    const lyricLines = prepareLyricDisplayLines(
      [
        line("A", 0, 5000),
        line("BG1", 100, 4000, true),
        line("BG2", 200, 3000, true),
        line("B", 6000, 7000),
      ],
      "off",
    );
    const component = mountLyrics({ lyricLines });
    expect(component.lyricPlayer.currentLyricGroups).toHaveLength(3);
  });

  it("背景行显示区间跟随主行而不扩展组时间", () => {
    const component = mountLyrics({
      lyricLines: [line("A", 1000, 3000), line("BG", 500, 4000, true)],
      lineSelectionPreference: "early-end",
    });

    component.scrollToTime(750);
    expect([...component.lyricPlayer.timelineState.bufferedGroups]).toEqual([]);
    component.scrollToTime(1500);
    expect([...component.lyricPlayer.timelineState.bufferedGroups]).toEqual([0]);
    component.scrollToTime(3500);
    expect([...component.lyricPlayer.timelineState.bufferedGroups]).toEqual([]);
    expect(component.lyricPlayer.currentLyricGroups[0].startTime).toBe(1000);
    expect(component.lyricPlayer.currentLyricGroups[0].endTime).toBe(3000);
  });

  it("Core 会保留共享尾段加速后的逐词时间", () => {
    const lyricLines = prepareLyricDisplayLines(
      [line("A", 0, 6000), line("B", 5000, 8000)],
      "aggressive",
      { gapThresholdMs: 2000, advanceMs: 1000, scrollLeadMs: 400 },
    );
    const component = mountLyrics({ lyricLines });
    const coreLine = component.lyricPlayer.currentLyricGroups[0].mainLine.getLine();
    expect(coreLine.endTime).toBe(4600);
    expect(coreLine.words[0].endTime).toBe(4600);
  });

  it("启用提早结束后在有效结束点立即滚到下一行", () => {
    const lyricLines = prepareLyricDisplayLines(
      [line("A", 0, 1000), line("B", 10000, 11000)],
      "aggressive",
      { gapThresholdMs: 1300, advanceMs: 1000, scrollLeadMs: 400 },
    );
    const component = mountLyrics({ lyricLines });

    component.scrollToTime(9599);
    expect(component.lyricPlayer.timelineState.scrollToIndex).toBe(0);
    component.scrollToTime(9600);
    expect(component.lyricPlayer.timelineState.scrollToIndex).toBe(1);
    expect([...component.lyricPlayer.timelineState.bufferedGroups]).toEqual([1]);
    expect([...component.lyricPlayer.timelineState.hotGroups]).toEqual([]);
  });

  it("提前选择下一行时取消 Core 级联延迟并立即启动滚动", () => {
    const lyricLines = prepareLyricDisplayLines(
      [line("A", 0, 1000), line("B", 10000, 11000)],
      "aggressive",
      { gapThresholdMs: 1300, advanceMs: 1000, scrollLeadMs: 400 },
    );
    const component = mountLyrics({ lyricLines });
    component.scrollToTime(9599);
    const layoutSpy = vi.spyOn(component.lyricPlayer, "calcLayout");

    component.setCurrentTime(9600);

    expect(layoutSpy).toHaveBeenCalledWith(true);
  });

  it("默认与提早选择逻辑会写入 Core 缓冲集合", async () => {
    const wrapper = mount(AMLLLyrics, {
      props: {
        lyricLines: [line("A", 0, 3000), line("B", 1000, 5000)],
        lineSelectionPreference: "default",
      },
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    const component = wrapper.vm as unknown as ExposedAmlPlayer;

    component.scrollToTime(3100);
    expect([...component.lyricPlayer.timelineState.bufferedGroups]).toEqual([0, 1]);
    await wrapper.setProps({ lineSelectionPreference: "early-end" });
    expect([...component.lyricPlayer.timelineState.bufferedGroups]).toEqual([1]);
  });

  it("重叠段使用 0.15，进入独立句后恢复用户位置", () => {
    const component = mountLyrics({
      lyricLines: [line("A", 0, 3000), line("B", 1000, 4000), line("C", 5000, 6000)],
      alignPosition: 0.3,
      raiseAlignPositionOnOverlap: true,
    });

    component.scrollToTime(1500);
    expect(component.lyricPlayer.layoutState.alignPosition).toBe(0.15);
    component.scrollToTime(5000);
    expect(component.lyricPlayer.layoutState.alignPosition).toBe(0.3);
  });
});
