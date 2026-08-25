import { describe, expect, it } from "vitest";
import type { LyricLine, LyricWord } from "@shared/types/lyrics";
import { applyScrollPreroll, getScrollPrerollTime } from "./utils/scroll-preroll";
import {
  applyEarlyLineEnd,
  buildLyricDisplayGroups,
  isAdvanceHandoffSnapshot,
  LyricDisplayScheduler,
  prepareLyricDisplayLines,
  resolveEffectiveAlignPosition,
} from "./display-timing";

const line = (
  startTime: number,
  endTime: number,
  options: { isBG?: boolean; words?: LyricWord[] } = {},
): LyricLine => ({
  words: options.words ?? [{ word: "test", startTime, endTime }],
  translatedLyric: "",
  romanLyric: "",
  startTime,
  endTime,
  isBG: options.isBG ?? false,
  isDuet: false,
});

describe("applyEarlyLineEnd", () => {
  it("提早结束预处理只生成时序，不接收选择句偏好", () => {
    const source = [line(0, 6000), line(5000, 8000)];
    const result = applyEarlyLineEnd(source, "aggressive", {
      gapThresholdMs: 2000,
      advanceMs: 1000,
      scrollLeadMs: 400,
    });

    expect(result[0].endTime).toBe(4600);
    expect(buildLyricDisplayGroups(result)[0].advanceAt).toBe(4600);
  });

  it("严格按下一句开始减滚动衔接和提前量计算加速窗口", () => {
    const source = [
      line(0, 6000, {
        words: [
          { word: "a", startTime: 0, endTime: 3000 },
          { word: "b", startTime: 3000, endTime: 5000 },
          { word: "c", startTime: 5000, endTime: 6000 },
        ],
      }),
      line(5000, 8000),
    ];
    const result = applyEarlyLineEnd(source, "aggressive", {
      gapThresholdMs: 2000,
      advanceMs: 1000,
      scrollLeadMs: 400,
    });
    const group = buildLyricDisplayGroups(result)[0];
    expect(result[0].words[0]).toEqual(source[0].words[0]);
    expect(result[0].words[2].endTime).toBe(4600);
    expect(result[0].endTime).toBe(4600);
    expect(group.advanceAt).toBe(4600);
  });

  it("保守档将主句和背景人声都加速到滚动衔接点", () => {
    const source = [line(0, 5000), line(2000, 9000, { isBG: true }), line(5500, 8000)];
    const result = applyEarlyLineEnd(source, "conservative", {
      gapThresholdMs: 1000,
      advanceMs: 1000,
      scrollLeadMs: 400,
    });
    expect(result[0].endTime).toBe(5100);
    expect(result[1].endTime).toBe(5100);
    expect(result[1].words.at(-1)?.endTime).toBe(5100);
  });

  it("激进档在滚动衔接点结束组但不强制加速背景人声", () => {
    const source = [line(0, 5000), line(2000, 9000, { isBG: true }), line(5500, 8000)];
    const result = applyEarlyLineEnd(source, "aggressive", {
      gapThresholdMs: 1000,
      advanceMs: 1000,
      scrollLeadMs: 400,
    });
    expect(result[0].endTime).toBe(5100);
    expect(result[1]).toBe(source[1]);
  });

  it("间隔阈值只依据主句最后一字，不受背景人声结尾影响", () => {
    const source = [
      line(0, 7000, {
        words: [
          { word: "a", startTime: 0, endTime: 3000 },
          { word: "b", startTime: 3000, endTime: 5000 },
        ],
      }),
      line(2000, 9000, { isBG: true }),
      line(5500, 8000),
    ];
    const disabled = applyEarlyLineEnd(source, "aggressive", {
      gapThresholdMs: 500,
      advanceMs: 1000,
      scrollLeadMs: 400,
    });
    expect(disabled[0].endTime).toBe(9000);
    const enabled = applyEarlyLineEnd(source, "aggressive", {
      gapThresholdMs: 501,
      advanceMs: 1000,
      scrollLeadMs: 400,
    });
    expect(enabled[0].endTime).toBe(5100);
  });

  it("滚动衔接时长同时决定加速终点与下一行滚动时点", () => {
    const source = [
      line(0, 6000, {
        words: [
          { word: "a", startTime: 0, endTime: 4000 },
          { word: "b", startTime: 4000, endTime: 5000 },
          { word: "c", startTime: 5000, endTime: 6000 },
        ],
      }),
      line(5000, 8000),
    ];
    const shorterLead = applyEarlyLineEnd(source, "aggressive", {
      gapThresholdMs: 2000,
      advanceMs: 1000,
      scrollLeadMs: 300,
    });
    const longerLead = applyEarlyLineEnd(source, "aggressive", {
      gapThresholdMs: 2000,
      advanceMs: 1000,
      scrollLeadMs: 600,
    });
    expect(shorterLead[0].endTime).toBe(4700);
    expect(longerLead[0].endTime).toBe(4400);
    expect(buildLyricDisplayGroups(shorterLead)[0].advanceAt).toBe(4700);
    expect(buildLyricDisplayGroups(longerLead)[0].advanceAt).toBe(4400);
  });

  it("没有下一主句时两个档位都会完整保留背景人声", () => {
    const source = [line(0, 5000), line(1000, 7000, { isBG: true })];
    expect(applyEarlyLineEnd(source, "conservative")[0].endTime).toBe(7000);
    expect(applyEarlyLineEnd(source, "aggressive")[0].endTime).toBe(7000);
  });

  it("激进档只映射主句尾段，窗口前的逐词和注音时间保持不变", () => {
    const source = [
      line(0, 6000, {
        words: [
          { word: "a", startTime: 0, endTime: 1000 },
          { word: "b", startTime: 1000, endTime: 3500 },
          {
            word: "c",
            startTime: 3500,
            endTime: 6000,
            ruby: [{ word: "c", startTime: 4000, endTime: 6000 }],
          },
        ],
      }),
      line(5000, 8000),
    ];
    const result = applyEarlyLineEnd(source, "aggressive", {
      gapThresholdMs: 1300,
      advanceMs: 1000,
      scrollLeadMs: 400,
    });
    expect(result[0].endTime).toBe(4600);
    expect(result[0].words.slice(0, 2)).toEqual(source[0].words.slice(0, 2));
    expect(result[0].words[2].startTime).toBe(3500);
    expect(result[0].words[2].endTime).toBe(4600);
    expect(result[0].words[2].ruby?.[0].startTime).toBeGreaterThan(3500);
    expect(result[0].words[2].ruby?.[0].endTime).toBe(4600);
    expect(source[0].endTime).toBe(6000);
  });

  it("关闭提前选择下一行时不写入滚动衔接元数据", () => {
    const result = applyEarlyLineEnd([line(0, 6000), line(5000, 8000)], "aggressive", {
      gapThresholdMs: 2000,
      advanceMs: 1000,
      scrollLeadMs: 400,
      advanceToNextLine: false,
    });
    expect(buildLyricDisplayGroups(result)[0].advanceAt).toBeUndefined();
  });

  it("滚动衔接点早于本句时不会生成非法提前滚动时点", () => {
    const result = applyEarlyLineEnd([line(0, 500), line(200, 1000)], "aggressive", {
      gapThresholdMs: 2000,
      advanceMs: 1000,
      scrollLeadMs: 400,
    });
    expect(buildLyricDisplayGroups(result)[0].advanceAt).toBeUndefined();
    expect(result[0].startTime).toBe(0);
  });

  it("关闭功能时保留原数组引用", () => {
    const source = [line(0, 1000)];
    expect(applyEarlyLineEnd(source, "off")).toBe(source);
  });

  it("统一输入会把连续第二条背景行转换为新的主歌词组", () => {
    const result = prepareLyricDisplayLines(
      [line(0, 1000), line(0, 1000, { isBG: true }), line(0, 1000, { isBG: true })],
      "off",
    );
    expect(result.map((item) => item.isBG)).toEqual([false, true, false]);
    expect(buildLyricDisplayGroups(result)).toHaveLength(2);
  });
});

describe("LyricDisplayScheduler", () => {
  it("重叠时长必须严格大于阈值才允许多行同亮", () => {
    const options = {
      maxHighlightedLines: "unlimited" as const,
      multiLineOverlapThresholdMs: 490,
      earlyEndMode: "aggressive" as const,
      lineSelectionPreference: "early-end" as const,
    };
    const boundary = new LyricDisplayScheduler([line(0, 1490), line(1000, 2000)]).update(
      1000,
      options,
    );
    expect([...boundary.highlightedLineIndexes]).toEqual([1]);

    const above = new LyricDisplayScheduler([line(0, 1491), line(1000, 2000)]).update(
      1000,
      options,
    );
    expect([...above.highlightedLineIndexes]).toEqual([0, 1]);
  });

  it("保守档忽略多行同亮阈值并让前一组完整滚完", () => {
    const snapshot = new LyricDisplayScheduler([line(0, 1490), line(1000, 2000)]).update(1000, {
      maxHighlightedLines: "unlimited",
      multiLineOverlapThresholdMs: 490,
      earlyEndMode: "conservative",
      lineSelectionPreference: "early-end",
    });
    expect([...snapshot.highlightedLineIndexes]).toEqual([0, 1]);
  });

  it("超过上限后强制结束最早组且顺播不重新亮起", () => {
    const scheduler = new LyricDisplayScheduler([
      line(0, 10000),
      line(2000, 5000),
      line(3000, 4000),
    ]);
    const options = {
      maxHighlightedLines: 2 as const,
      lineSelectionPreference: "early-end" as const,
    };
    const overflow = scheduler.update(3000, options);
    expect([...overflow.highlightedLineIndexes]).toEqual([1, 2]);
    expect([...overflow.forcedEndedGroupIds]).toEqual([0]);
    expect([...scheduler.update(4500, options).highlightedLineIndexes]).toEqual([1]);
  });

  it("已熄灭的中间组仍占用顺序窗口，第三组开始时淘汰更早长句", () => {
    const lines = [line(0, 10000), line(1000, 2000), line(3000, 4000)];
    const options = {
      maxHighlightedLines: 2 as const,
      lineSelectionPreference: "early-end" as const,
    };
    const scheduler = new LyricDisplayScheduler(lines);

    expect([...scheduler.update(2500, options).highlightedLineIndexes]).toEqual([0]);
    const third = scheduler.update(3000, options);
    expect([...third.highlightedLineIndexes]).toEqual([2]);
    expect(third.forcedEndedGroupIds.has(0)).toBe(true);

    const sought = new LyricDisplayScheduler(lines).seek(3000, options);
    expect([...sought.highlightedLineIndexes]).toEqual([2]);
    expect(sought.forcedEndedGroupIds.has(0)).toBe(true);
  });

  it("seek 会按历史开始事件重建强制结束状态", () => {
    const scheduler = new LyricDisplayScheduler([
      line(0, 10000),
      line(2000, 5000),
      line(3000, 4000),
    ]);
    const snapshot = scheduler.seek(4500, {
      maxHighlightedLines: 2,
      lineSelectionPreference: "early-end",
    });
    expect([...snapshot.highlightedLineIndexes]).toEqual([1]);
    expect(snapshot.forcedEndedGroupIds.has(0)).toBe(true);
  });

  it("跨过多个开始事件的大步进与 seek 结果一致", () => {
    const lines = [line(0, 10000), line(2000, 5000), line(3000, 4000)];
    const options = {
      maxHighlightedLines: 2 as const,
      lineSelectionPreference: "early-end" as const,
    };
    const scheduler = new LyricDisplayScheduler(lines);
    scheduler.update(0, options);
    const advanced = scheduler.update(4500, options);
    const sought = new LyricDisplayScheduler(lines).seek(4500, options);
    expect([...advanced.highlightedLineIndexes]).toEqual([...sought.highlightedLineIndexes]);
    expect([...advanced.forcedEndedGroupIds]).toEqual([...sought.forcedEndedGroupIds]);
  });

  it("背景行随主组高亮且不单独占用上限", () => {
    const scheduler = new LyricDisplayScheduler([
      line(0, 5000),
      line(100, 4800, { isBG: true }),
      line(1000, 4000),
    ]);
    const snapshot = scheduler.update(1500, {
      maxHighlightedLines: 2,
      lineSelectionPreference: "early-end",
    });
    expect([...snapshot.highlightedLineIndexes]).toEqual([0, 1, 2]);
  });

  it("默认模式等待结束瞬间仍在演唱的组结束", () => {
    const scheduler = new LyricDisplayScheduler([line(0, 3000), line(1000, 5000)]);
    const options = {
      maxHighlightedLines: "unlimited" as const,
      lineSelectionPreference: "default" as const,
    };
    expect([...scheduler.update(3100, options).highlightedLineIndexes]).toEqual([0, 1]);
    expect([...scheduler.update(5000, options).highlightedLineIndexes]).toEqual([]);
  });

  it("提早结束模式在各组自身结束时间立即熄灭", () => {
    const scheduler = new LyricDisplayScheduler([line(0, 3000), line(1000, 5000)]);
    const snapshot = scheduler.update(3100, {
      maxHighlightedLines: "unlimited",
      lineSelectionPreference: "early-end",
    });
    expect([...snapshot.highlightedLineIndexes]).toEqual([1]);
  });

  it("默认保留只等待结束瞬间已经在演唱的组", () => {
    const scheduler = new LyricDisplayScheduler([
      line(0, 3000),
      line(1000, 5000),
      line(4000, 6000),
    ]);
    const options = {
      maxHighlightedLines: "unlimited" as const,
      lineSelectionPreference: "default" as const,
    };
    expect([...scheduler.update(4500, options).highlightedLineIndexes]).toEqual([0, 1, 2]);
    expect([...scheduler.update(5000, options).highlightedLineIndexes]).toEqual([1, 2]);
    expect([...scheduler.update(6000, options).highlightedLineIndexes]).toEqual([]);
  });

  it("运行时降低上限后立即淘汰且提高上限不会复亮", () => {
    const scheduler = new LyricDisplayScheduler([
      line(0, 5000),
      line(1000, 5000),
      line(2000, 5000),
    ]);
    scheduler.update(2500, {
      maxHighlightedLines: "unlimited",
      lineSelectionPreference: "early-end",
    });
    const limited = scheduler.update(2500, {
      maxHighlightedLines: 2,
      lineSelectionPreference: "early-end",
    });
    expect([...limited.highlightedLineIndexes]).toEqual([1, 2]);
    const expanded = scheduler.update(2600, {
      maxHighlightedLines: 3,
      lineSelectionPreference: "early-end",
    });
    expect([...expanded.highlightedLineIndexes]).toEqual([1, 2]);
  });

  it("相同开始时间按原始行索引稳定淘汰", () => {
    const scheduler = new LyricDisplayScheduler([line(0, 5000), line(0, 5000), line(0, 5000)]);
    const snapshot = scheduler.update(0, {
      maxHighlightedLines: 2,
      lineSelectionPreference: "early-end",
    });
    expect([...snapshot.highlightedLineIndexes]).toEqual([1, 2]);
  });

  it("默认模式不会继续等待已经被上限强制结束的组", () => {
    const scheduler = new LyricDisplayScheduler([
      line(0, 10000),
      line(2000, 5000),
      line(3000, 4000),
    ]);
    const options = {
      maxHighlightedLines: 2 as const,
      lineSelectionPreference: "default" as const,
    };
    scheduler.update(3000, options);
    expect([...scheduler.update(5000, options).highlightedLineIndexes]).toEqual([]);
  });
});

describe("滚动预滚与重叠对齐", () => {
  it("预滚提前滚动但不会提前高亮或占用行数", () => {
    const lines = applyScrollPreroll([line(1000, 2000), line(3000, 4000)]);
    expect(lines[0].startTime).toBe(1000);
    expect(getScrollPrerollTime(lines[0])).toBe(400);
    const snapshot = new LyricDisplayScheduler(lines).update(500, {
      maxHighlightedLines: 2,
      lineSelectionPreference: "early-end",
    });
    expect([...snapshot.highlightedLineIndexes]).toEqual([]);
    expect(snapshot.scrollTargetLineIndex).toBe(0);
  });

  it("长间奏会在预滚边界前保持上一行锚点", () => {
    const lines = applyScrollPreroll([line(0, 1000), line(10000, 11000)]);
    const scheduler = new LyricDisplayScheduler(lines);
    const options = {
      maxHighlightedLines: "unlimited" as const,
      lineSelectionPreference: "default" as const,
    };
    expect(scheduler.update(9399, options).scrollTargetLineIndex).toBe(0);
    expect(scheduler.update(9400, options).scrollTargetLineIndex).toBe(1);
  });

  it("非关闭档位在有效结束后立即滚动到下一行", () => {
    const lines = applyScrollPreroll(
      prepareLyricDisplayLines(
        [
          line(0, 2000, {
            words: [{ word: "test", startTime: 0, endTime: 1000 }],
          }),
          line(10000, 11000),
        ],
        "aggressive",
        { gapThresholdMs: 1300, advanceMs: 1000, scrollLeadMs: 400 },
      ),
    );
    const scheduler = new LyricDisplayScheduler(lines);
    const options = {
      maxHighlightedLines: "unlimited" as const,
      lineSelectionPreference: "default" as const,
    };
    expect(scheduler.update(9599, options).scrollTargetLineIndex).toBe(0);
    const advanced = scheduler.update(9600, options);
    expect(advanced.scrollTargetLineIndex).toBe(1);
    expect([...advanced.highlightedLineIndexes]).toEqual([]);
    expect([...advanced.selectedLineIndexes]).toEqual([1]);
    expect([...advanced.hotGroupIds]).toEqual([]);
    expect(isAdvanceHandoffSnapshot(advanced)).toBe(true);
  });

  it("关闭提前选择时不会在滚动衔接点点亮下一行", () => {
    const lines = applyScrollPreroll(
      prepareLyricDisplayLines([line(0, 1000), line(10000, 11000)], "aggressive", {
        gapThresholdMs: 1300,
        advanceMs: 1000,
        scrollLeadMs: 400,
        advanceToNextLine: false,
      }),
    );
    const snapshot = new LyricDisplayScheduler(lines).update(9600, {
      maxHighlightedLines: "unlimited",
      lineSelectionPreference: "default",
    });

    expect(snapshot.scrollTargetLineIndex).toBe(1);
    expect([...snapshot.selectedLineIndexes]).toEqual([]);
  });

  it("关闭档位仍在长间奏的预滚边界切换", () => {
    const lines = applyScrollPreroll(
      prepareLyricDisplayLines([line(0, 1000), line(10000, 11000)], "off"),
    );
    const scheduler = new LyricDisplayScheduler(lines);
    const options = {
      maxHighlightedLines: "unlimited" as const,
      lineSelectionPreference: "default" as const,
    };
    expect(scheduler.update(1000, options).scrollTargetLineIndex).toBe(0);
    expect(scheduler.update(9400, options).scrollTargetLineIndex).toBe(1);
  });

  it("未来重叠段不会在预滚边界前提前抬高对齐", () => {
    const lines = applyScrollPreroll([line(0, 1000), line(10000, 12000), line(11000, 13000)]);
    const scheduler = new LyricDisplayScheduler(lines);
    const options = {
      maxHighlightedLines: "unlimited" as const,
      lineSelectionPreference: "default" as const,
    };
    const before = scheduler.update(9399, options);
    expect(resolveEffectiveAlignPosition(before.highlightedGroupIds.size, 0.3, true)).toBe(0.3);

    const preroll = scheduler.update(9400, options);
    expect(resolveEffectiveAlignPosition(preroll.highlightedGroupIds.size, 0.3, true)).toBe(0.3);
  });

  it("实际多行同亮时抬到 0.15，剩一行时立即恢复用户值", () => {
    expect(resolveEffectiveAlignPosition(2, 0.3, true)).toBe(0.15);
    expect(resolveEffectiveAlignPosition(1, 0.3, true)).toBe(0.3);
    expect(resolveEffectiveAlignPosition(2, 0.1, true)).toBe(0.1);
  });

  it("关闭抬高设置时始终使用用户值", () => {
    expect(resolveEffectiveAlignPosition(3, 0.3, false)).toBe(0.3);
  });
});
