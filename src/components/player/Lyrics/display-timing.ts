import type { LyricLine, LyricSpan, LyricWord } from "@shared/types/lyrics";
import type {
  LyricEarlyEndMode,
  LyricLineSelectionPreference,
  MaxHighlightedLines,
} from "@/types/settings";
import { getScrollPrerollTime } from "./utils/scroll-preroll";

interface EarlyEndPlan {
  accelerationStart: number;
  originalEnd: number;
  forcedEnd: number;
}

type TimedLyricLine = LyricLine & { __advanceAt?: number };

export interface LyricEarlyEndOptions {
  gapThresholdMs: number;
  advanceMs: number;
  scrollLeadMs: number;
  advanceToNextLine?: boolean;
}

export interface LyricDisplayGroup {
  id: number;
  mainIndex: number;
  backgroundIndex?: number;
  startTime: number;
  endTime: number;
  scrollStartTime: number;
  overlapsPrevious: boolean;
  overlapsNext: boolean;
  advanceAt?: number;
}

export interface LyricDisplayOptions {
  maxHighlightedLines: MaxHighlightedLines;
  multiLineOverlapThresholdMs?: number;
  earlyEndMode?: LyricEarlyEndMode;
  lineSelectionPreference: LyricLineSelectionPreference;
}

export interface LyricDisplaySnapshot {
  hotGroupIds: ReadonlySet<number>;
  highlightedGroupIds: ReadonlySet<number>;
  selectedGroupIds: ReadonlySet<number>;
  forcedEndedGroupIds: ReadonlySet<number>;
  highlightedLineIndexes: ReadonlySet<number>;
  selectedLineIndexes: ReadonlySet<number>;
  scrollTargetLineIndex: number;
}

/** 判断当前快照是否正在提前选中并滚向尚未自然开始的下一行。 */
export const isAdvanceHandoffSnapshot = (snapshot: LyricDisplaySnapshot): boolean =>
  snapshot.selectedLineIndexes.has(snapshot.scrollTargetLineIndex) &&
  !snapshot.highlightedLineIndexes.has(snapshot.scrollTargetLineIndex);

/** 将连续多条背景行转换为一条背景行加后续主行，统一两个渲染器的分组。 */
export const normalizeLyricDisplayLines = (lines: readonly LyricLine[]): LyricLine[] => {
  let consecutiveBackgrounds = 0;
  return lines.map((line) => {
    if (!line.isBG) {
      consecutiveBackgrounds = 0;
      return line;
    }
    consecutiveBackgrounds++;
    return consecutiveBackgrounds === 1 ? line : { ...line, isBG: false };
  });
};

/** 将尾段时间连续映射到更早的结束点，窗口之前的时间保持不变。 */
const remapTailTime = (time: number, plan: EarlyEndPlan): number => {
  if (time <= plan.accelerationStart) return time;
  if (time >= plan.originalEnd) return plan.forcedEnd;
  const sourceDuration = plan.originalEnd - plan.accelerationStart;
  const targetDuration = plan.forcedEnd - plan.accelerationStart;
  return (
    plan.accelerationStart + ((time - plan.accelerationStart) / sourceDuration) * targetDuration
  );
};

/** 映射词或注音片段并保证时间区间不反转。 */
const remapSpan = (span: LyricSpan, plan: EarlyEndPlan): LyricSpan => {
  const startTime = remapTailTime(span.startTime, plan);
  const endTime = remapTailTime(span.endTime, plan);
  return { ...span, startTime, endTime: Math.max(startTime, endTime) };
};

/** 使用主歌词组的同一尾段计划映射主行和背景行。 */
const applyEarlyEndPlan = (line: LyricLine, plan: EarlyEndPlan, advanceAt?: number): LyricLine => {
  const startTime = Math.min(plan.forcedEnd, remapTailTime(line.startTime, plan));
  const words: LyricWord[] = line.words.map((word) => {
    const remapped = remapSpan(word, plan);
    return {
      ...word,
      startTime: remapped.startTime,
      endTime: remapped.endTime,
      ruby: word.ruby?.map((span) => remapSpan(span, plan)),
    };
  });
  return {
    ...line,
    __advanceAt: advanceAt,
    startTime,
    endTime: plan.forcedEnd,
    words,
  } as TimedLyricLine;
};

/** 使用最后一个逐字时间作为主句的有效结束时间。 */
const getEffectiveEndTime = (line: LyricLine): number => line.words.at(-1)?.endTime ?? line.endTime;

/** 取主句与背景人声完整滚动后的最晚结束时间。 */
const resolveNaturalEnd = (mainEnd: number, backgroundEnd?: number): number =>
  Math.max(mainEnd, backgroundEnd ?? mainEnd);

/** 同步调度器使用的组结束时间与可选的下一行滚动时点。 */
const applyEffectiveEnd = (line: LyricLine, effectiveEnd: number, advanceAt?: number): LyricLine =>
  ({ ...line, __advanceAt: advanceAt, endTime: effectiveEnd }) as TimedLyricLine;

/** 解析固定滚动衔接时长。 */
const resolveScrollLead = (options: LyricEarlyEndOptions): number =>
  Math.max(0, options.scrollLeadMs);

/** 按下一句开始时间计算尾段加速起点、终点和下一行滚动时点。 */
const resolveEarlyEndWindow = (
  nextLine: LyricLine,
  options: LyricEarlyEndOptions,
): Pick<EarlyEndPlan, "accelerationStart" | "forcedEnd"> => {
  const forcedEnd = nextLine.startTime - resolveScrollLead(options);
  return {
    accelerationStart: forcedEnd - Math.max(0, options.advanceMs),
    forcedEnd,
  };
};

/**
 * 为两个歌词渲染器生成一致的有效时序。
 * 提早结束档位只负责生成时序；选择句偏好由显示调度器独立处理。
 */
export const applyEarlyLineEnd = (
  lines: LyricLine[],
  mode: LyricEarlyEndMode,
  options: LyricEarlyEndOptions = { gapThresholdMs: 1300, advanceMs: 700, scrollLeadMs: 850 },
): LyricLine[] => {
  if (mode === "off") return lines;

  const mainIndexes = lines.flatMap((line, index) => (line.isBG ? [] : [index]));
  const result = [...lines];

  for (let position = 0; position < mainIndexes.length; position++) {
    const mainIndex = mainIndexes[position];
    const backgroundIndex = lines[mainIndex + 1]?.isBG ? mainIndex + 1 : undefined;
    const background = backgroundIndex === undefined ? undefined : lines[backgroundIndex];
    const nextMainIndex = mainIndexes[position + 1];
    const nextLine = nextMainIndex === undefined ? undefined : lines[nextMainIndex];
    const mainEnd = getEffectiveEndTime(lines[mainIndex]);
    const backgroundEnd = background ? getEffectiveEndTime(background) : undefined;
    const naturalEnd = resolveNaturalEnd(mainEnd, backgroundEnd);
    if (!nextLine) {
      result[mainIndex] = applyEffectiveEnd(lines[mainIndex], naturalEnd);
      continue;
    }

    const window = resolveEarlyEndWindow(nextLine, options);
    const validHandoff = window.forcedEnd > lines[mainIndex].startTime;
    const advanceAt =
      options.advanceToNextLine === false || !validHandoff ? undefined : window.forcedEnd;
    result[mainIndex] = applyEffectiveEnd(lines[mainIndex], naturalEnd, advanceAt);
    const contentStart = lines[mainIndex].words[0]?.startTime ?? lines[mainIndex].startTime;
    if (
      nextLine.startTime - mainEnd >= options.gapThresholdMs ||
      window.forcedEnd >= naturalEnd ||
      window.accelerationStart < contentStart
    ) {
      continue;
    }

    if (mode === "conservative") {
      const plan = { ...window, originalEnd: naturalEnd };
      result[mainIndex] = applyEarlyEndPlan(lines[mainIndex], plan, advanceAt);
      if (backgroundIndex !== undefined) {
        result[backgroundIndex] = applyEarlyEndPlan(lines[backgroundIndex], plan);
      }
      continue;
    }

    const mainPlan = { ...window, originalEnd: mainEnd };
    result[mainIndex] =
      window.forcedEnd < mainEnd
        ? applyEarlyEndPlan(lines[mainIndex], mainPlan, advanceAt)
        : applyEffectiveEnd(lines[mainIndex], window.forcedEnd, advanceAt);
  }
  return result;
};

/** 规范化分组并应用提早结束时序，作为播放器统一显示输入。 */
export const prepareLyricDisplayLines = (
  lines: readonly LyricLine[],
  mode: LyricEarlyEndMode,
  options?: LyricEarlyEndOptions,
): LyricLine[] => applyEarlyLineEnd(normalizeLyricDisplayLines(lines), mode, options);

/** 将主歌词和紧随其后的背景歌词合并为显示组。 */
export const buildLyricDisplayGroups = (lines: readonly LyricLine[]): LyricDisplayGroup[] => {
  const groups: LyricDisplayGroup[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.isBG) continue;
    groups.push({
      id: groups.length,
      mainIndex: index,
      backgroundIndex: lines[index + 1]?.isBG ? index + 1 : undefined,
      startTime: line.startTime,
      endTime: line.endTime,
      scrollStartTime: getScrollPrerollTime(line),
      overlapsPrevious: false,
      overlapsNext: false,
      advanceAt: (line as TimedLyricLine).__advanceAt,
    });
  }

  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    const previous = groups[index - 1];
    const next = groups[index + 1];
    group.overlapsPrevious = !!previous && previous.endTime > group.startTime;
    group.overlapsNext = !!next && group.endTime > next.startTime;
  }
  return groups;
};

/** 根据当前组和用户设置计算布局使用的临时对齐位置。 */
export const resolveEffectiveAlignPosition = (
  highlightedGroupCount: number,
  userPosition: number,
  enabled: boolean,
): number => {
  return enabled && userPosition > 0.15 && highlightedGroupCount > 1 ? 0.15 : userPosition;
};

/** 事件驱动的歌词显示调度器。 */
export class LyricDisplayScheduler {
  readonly groups: LyricDisplayGroup[];
  private readonly stateEventTimes: number[];
  private readonly displayEventTimes: number[];
  private highlightedGroupIds = new Set<number>();
  private forcedEndedGroupIds = new Set<number>();
  private waitingDependencies = new Map<number, Set<number>>();
  private currentTime = -1;
  private nextDisplayEventIndex = 0;
  private lastOptionsKey = "";
  private lastSnapshot: LyricDisplaySnapshot | undefined;

  constructor(private readonly lines: readonly LyricLine[]) {
    this.groups = buildLyricDisplayGroups(lines);
    this.stateEventTimes = [
      ...new Set(this.groups.flatMap((group) => [group.startTime, group.endTime])),
    ].sort((left, right) => left - right);
    this.displayEventTimes = [
      ...new Set([
        ...this.stateEventTimes,
        ...this.groups.flatMap((group) =>
          group.advanceAt === undefined
            ? [group.scrollStartTime]
            : [group.scrollStartTime, group.advanceAt],
        ),
      ]),
    ].sort((left, right) => left - right);
  }

  update(time: number, options: LyricDisplayOptions): LyricDisplaySnapshot {
    if (this.currentTime < 0 || time < this.currentTime) return this.seek(time, options);
    const optionsKey = this.getOptionsKey(options);
    const optionsChanged = optionsKey !== this.lastOptionsKey;
    const crossedDisplayEvent = this.displayEventTimes[this.nextDisplayEventIndex] <= time;
    if (optionsChanged) this.applyOptionChange(options);
    for (const eventTime of this.stateEventTimes) {
      if (eventTime <= this.currentTime) continue;
      if (eventTime > time) break;
      this.processStateEvent(eventTime, options);
    }
    this.currentTime = time;
    if (this.lastSnapshot && !optionsChanged && !crossedDisplayEvent) return this.lastSnapshot;
    return this.cacheSnapshot(this.createSnapshot(time), optionsKey);
  }

  seek(time: number, options: LyricDisplayOptions): LyricDisplaySnapshot {
    this.currentTime = -1;
    this.highlightedGroupIds.clear();
    this.forcedEndedGroupIds.clear();
    this.waitingDependencies.clear();
    for (const eventTime of this.stateEventTimes) {
      if (eventTime > time) break;
      this.processStateEvent(eventTime, options);
    }
    this.currentTime = time;
    return this.cacheSnapshot(this.createSnapshot(time), this.getOptionsKey(options));
  }

  private getOptionsKey = (options: LyricDisplayOptions): string =>
    `${options.maxHighlightedLines}:${options.multiLineOverlapThresholdMs ?? 490}:${options.earlyEndMode ?? "aggressive"}:${options.lineSelectionPreference}`;

  private cacheSnapshot(snapshot: LyricDisplaySnapshot, optionsKey: string): LyricDisplaySnapshot {
    this.lastSnapshot = snapshot;
    this.lastOptionsKey = optionsKey;
    this.nextDisplayEventIndex = this.displayEventTimes.findIndex(
      (eventTime) => eventTime > this.currentTime,
    );
    if (this.nextDisplayEventIndex === -1) {
      this.nextDisplayEventIndex = this.displayEventTimes.length;
    }
    return snapshot;
  }

  private isNaturallyHot = (groupId: number, time: number): boolean => {
    const group = this.groups[groupId];
    return !!group && group.startTime <= time && group.endTime > time;
  };

  private getNaturalHotIds = (time: number): Set<number> =>
    new Set(
      this.groups
        .filter((group) => group.startTime <= time && group.endTime > time)
        .map((group) => group.id),
    );

  private processStateEvent(time: number, options: LyricDisplayOptions): void {
    const endingIds = this.groups
      .filter((group) => group.endTime === time)
      .map((group) => group.id);

    for (const groupId of endingIds) {
      if (!this.highlightedGroupIds.has(groupId)) continue;
      if (options.lineSelectionPreference === "early-end") {
        this.highlightedGroupIds.delete(groupId);
        this.waitingDependencies.delete(groupId);
        continue;
      }
      const dependencies = new Set(
        this.groups
          .filter(
            (candidate) =>
              candidate.id !== groupId &&
              candidate.startTime < time &&
              candidate.endTime > time &&
              !this.forcedEndedGroupIds.has(candidate.id),
          )
          .map((candidate) => candidate.id),
      );
      if (dependencies.size > 0) this.waitingDependencies.set(groupId, dependencies);
      else this.highlightedGroupIds.delete(groupId);
    }

    for (const groupId of endingIds) this.releaseDependency(groupId, time);

    for (const group of this.groups) {
      if (group.startTime !== time || this.forcedEndedGroupIds.has(group.id)) continue;
      this.endShortOverlaps(group, time, options);
      this.highlightedGroupIds.add(group.id);
    }
    this.applyLimit(time, options.maxHighlightedLines);
  }

  private releaseDependency(groupId: number, time: number): void {
    for (const [waitingId, dependencies] of this.waitingDependencies) {
      if (!dependencies.delete(groupId) || dependencies.size > 0) continue;
      this.waitingDependencies.delete(waitingId);
      if (!this.isNaturallyHot(waitingId, time)) this.highlightedGroupIds.delete(waitingId);
    }
  }

  /** 新主句开始时，仅保留超过阈值的真实重叠高亮。 */
  private endShortOverlaps(
    nextGroup: LyricDisplayGroup,
    time: number,
    options: LyricDisplayOptions,
  ): void {
    const earlyEndMode = options.earlyEndMode ?? "aggressive";
    if (options.lineSelectionPreference !== "early-end" || earlyEndMode !== "aggressive") return;
    const threshold = Math.max(0, options.multiLineOverlapThresholdMs ?? 490);
    const currentGroup = this.groups[nextGroup.id - 1];
    if (!currentGroup || !this.highlightedGroupIds.has(currentGroup.id)) return;
    if (currentGroup.endTime - nextGroup.startTime > threshold) return;
    this.forceEndGroup(currentGroup.id, time);
  }

  private forceEndGroup(groupId: number, time: number): void {
    this.forcedEndedGroupIds.add(groupId);
    this.highlightedGroupIds.delete(groupId);
    this.waitingDependencies.delete(groupId);
    this.releaseDependency(groupId, time);
  }

  private applyLimit(time: number, limit: MaxHighlightedLines): void {
    if (limit === "unlimited") return;
    const chronologicalWindow = new Set(
      this.groups
        .filter((group) => group.startTime <= time)
        .sort((left, right) => left.startTime - right.startTime || left.mainIndex - right.mainIndex)
        .slice(-limit)
        .map((group) => group.id),
    );
    for (const groupId of [...this.highlightedGroupIds]) {
      if (!chronologicalWindow.has(groupId)) this.forceEndGroup(groupId, time);
    }
  }

  private applyOptionChange(options: LyricDisplayOptions): void {
    for (const group of this.groups) {
      if (group.startTime > this.currentTime) break;
      this.endShortOverlaps(group, this.currentTime, options);
    }
    if (options.lineSelectionPreference === "early-end") {
      for (const groupId of this.highlightedGroupIds) {
        if (!this.isNaturallyHot(groupId, this.currentTime)) {
          this.highlightedGroupIds.delete(groupId);
        }
      }
      this.waitingDependencies.clear();
    }
    this.applyLimit(this.currentTime, options.maxHighlightedLines);
  }

  private resolveAdvanceTarget = (time: number): LyricDisplayGroup | undefined => {
    for (let index = this.groups.length - 2; index >= 0; index--) {
      const group = this.groups[index];
      const next = this.groups[index + 1];
      if (group.advanceAt !== undefined && group.advanceAt <= time && next.startTime > time) {
        return next;
      }
    }
    return undefined;
  };

  private resolvePendingAdvanceSource = (time: number): LyricDisplayGroup | undefined => {
    for (let index = this.groups.length - 2; index >= 0; index--) {
      const group = this.groups[index];
      const next = this.groups[index + 1];
      if (
        group.advanceAt !== undefined &&
        group.startTime <= time &&
        group.advanceAt > time &&
        next.startTime > time
      ) {
        return group;
      }
    }
    return undefined;
  };

  private resolveScrollTarget = (time: number): LyricDisplayGroup | undefined => {
    const advanceTarget = this.resolveAdvanceTarget(time);
    if (advanceTarget) return advanceTarget;

    const highlighted = [...this.highlightedGroupIds]
      .map((groupId) => this.groups[groupId])
      .sort((left, right) => left.startTime - right.startTime || left.mainIndex - right.mainIndex);
    if (highlighted.length > 0) return highlighted[0];

    const pendingAdvanceSource = this.resolvePendingAdvanceSource(time);
    if (pendingAdvanceSource) return pendingAdvanceSource;

    const prerollTarget = this.groups.find(
      (group) => group.scrollStartTime <= time && group.startTime > time,
    );
    if (prerollTarget) return prerollTarget;

    const previous = [...this.groups].reverse().find((group) => group.startTime <= time);
    const future = this.groups.find((group) => group.startTime > time);
    if (!previous) return future;
    if (!future && previous.endTime <= time) return undefined;
    return previous;
  };

  private createSnapshot(time: number): LyricDisplaySnapshot {
    const highlightedLineIndexes = new Set<number>();
    for (const groupId of this.highlightedGroupIds) {
      const group = this.groups[groupId];
      highlightedLineIndexes.add(group.mainIndex);
      if (group.backgroundIndex !== undefined) highlightedLineIndexes.add(group.backgroundIndex);
    }
    const scrollTarget = this.resolveScrollTarget(time);
    const advanceTarget = this.resolveAdvanceTarget(time);
    const selectedGroupIds = new Set(this.highlightedGroupIds);
    if (advanceTarget) selectedGroupIds.add(advanceTarget.id);
    const selectedLineIndexes = new Set(highlightedLineIndexes);
    for (const groupId of selectedGroupIds) {
      const group = this.groups[groupId];
      selectedLineIndexes.add(group.mainIndex);
      if (group.backgroundIndex !== undefined) selectedLineIndexes.add(group.backgroundIndex);
    }
    return {
      hotGroupIds: this.getNaturalHotIds(time),
      highlightedGroupIds: new Set(this.highlightedGroupIds),
      selectedGroupIds,
      forcedEndedGroupIds: new Set(this.forcedEndedGroupIds),
      highlightedLineIndexes,
      selectedLineIndexes,
      scrollTargetLineIndex: scrollTarget?.mainIndex ?? this.lines.length,
    };
  }
}
