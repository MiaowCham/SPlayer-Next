/**
 * 歌词引擎 seek 后行位置回归测试
 *
 * 模拟快速长距离拖动进度条，检验所有行最终是否严格顺序排布（无重叠 / 残留伪影）
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LyricRenderer } from "lyric-dom";
import type { LyricLine } from "@shared/types/lyrics";

/** 手动步进的 rAF 队列 */
let rafQueue: { id: number; cb: (t: number) => void }[] = [];
let rafNextId = 0;
let frameClock = 0;

const stepFrame = (ms = 16) => {
  frameClock += ms;
  const queue = rafQueue;
  rafQueue = [];
  for (const { cb } of queue) cb(frameClock);
};

const makeLines = (count: number): LyricLine[] => {
  const lines: LyricLine[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * 3000;
    lines.push({
      startTime: start,
      endTime: start + 2800,
      words: [
        { word: `词${i}a`, startTime: start, endTime: start + 1400 },
        { word: `词${i}b`, startTime: start + 1400, endTime: start + 2800 },
      ],
      translatedLyric: "",
      romanLyric: "",
      isBG: false,
      isDuet: false,
    });
  }
  return lines;
};

const createContainer = () => {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", { value: 900 });
  Object.defineProperty(container, "clientHeight", { value: 800 });
  document.body.appendChild(container);
  return container;
};

const VIEW_HEIGHT = 800;
const LINE_HEIGHT = 40;

/**
 * 校验视口内无残留伪影：
 * - 可见行之间不重叠
 * - 可见行的 DOM 位置必须与弹簧当前位置一致（未同步的行必须已被移出视口）
 */
const expectNoVisibleGhost = (renderer: LyricRenderer) => {
  const engine = renderer as unknown as {
    lineElements: HTMLDivElement[];
    positionSprings: { getCurrentPosition(): number }[];
  };
  const visible: number[] = [];
  const offenders: string[] = [];
  for (let i = 0; i < engine.lineElements.length; i++) {
    const match = engine.lineElements[i].style.transform.match(/translateY\((-?[\d.]+)px\)/);
    const domY = match ? Number.parseFloat(match[1]) : Number.NaN;
    const springY = engine.positionSprings[i].getCurrentPosition();
    if (Math.abs(domY - springY) > 1 && domY > -LINE_HEIGHT && domY < VIEW_HEIGHT) {
      offenders.push(`行${i} DOM=${domY} 残留在视口内（弹簧=${springY.toFixed(1)}）`);
    }
    if (domY > -LINE_HEIGHT && domY < VIEW_HEIGHT) visible.push(domY);
  }
  expect(offenders, offenders.join("; ")).toHaveLength(0);

  visible.sort((a, b) => a - b);
  const overlaps: string[] = [];
  for (let i = 1; i < visible.length; i++) {
    if (visible[i] - visible[i - 1] < LINE_HEIGHT - 1) {
      overlaps.push(`${visible[i - 1]} ~ ${visible[i]}`);
    }
  }
  expect(overlaps, `可见行重叠: ${overlaps.join(", ")}`).toHaveLength(0);
};

const runToSettle = (renderer: LyricRenderer, frames = 2000) => {
  for (let i = 0; i < frames; i++) stepFrame();
  expect(renderer).toBeTruthy();
};

describe("歌词引擎 seek 后布局", () => {
  beforeEach(() => {
    rafQueue = [];
    rafNextId = 0;
    frameClock = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
      rafQueue.push({ id: ++rafNextId, cb });
      return rafNextId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      rafQueue = rafQueue.filter((r) => r.id !== id);
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
      },
    );
  });

  it("多行同亮时抬高，退出重叠或关闭设置后恢复", () => {
    const container = createContainer();
    const renderer = new LyricRenderer(container, {
      enableFloatAnimation: false,
      playing: true,
      alignPosition: 0.35,
      raiseAlignPositionOnOverlap: true,
    });
    const lines = makeLines(3);
    lines[0].endTime = 4500;
    lines[0].words[1].endTime = 4500;
    renderer.setLyrics(lines);
    const engine = renderer as unknown as {
      positionSprings: { getCurrentPosition(): number }[];
    };
    renderer.setCurrentTime(3500);
    runToSettle(renderer);
    expect(engine.positionSprings[0].getCurrentPosition()).toBeCloseTo(220, 0);
    renderer.setConfig({ raiseAlignPositionOnOverlap: false });
    runToSettle(renderer);
    expect(engine.positionSprings[0].getCurrentPosition()).toBeCloseTo(800 * 0.35 - 20, 0);
    renderer.setConfig({ raiseAlignPositionOnOverlap: true });
    renderer.setCurrentTime(4600);
    runToSettle(renderer);
    expect(engine.positionSprings[1].getCurrentPosition()).toBeCloseTo(800 * 0.35 - 20, 0);
    renderer.dispose();
    container.remove();
  });

  it("第三行原地高亮，首行退出后才按新两行滚动", () => {
    const container = createContainer();
    const renderer = new LyricRenderer(container, {
      enableFloatAnimation: false,
      playing: true,
      alignPosition: 0.35,
      raiseAlignPositionOnOverlap: true,
    });
    const lines = makeLines(3);
    lines[0].endTime = 8000;
    lines[1].endTime = 8500;
    renderer.setLyrics(lines);
    const engine = renderer as unknown as { positionSprings: { getCurrentPosition(): number }[] };
    renderer.setCurrentTime(3500);
    runToSettle(renderer);
    expect(engine.positionSprings[0].getCurrentPosition()).toBeCloseTo(220, 0);
    renderer.setCurrentTime(5000);
    renderer.setCurrentTime(6500);
    runToSettle(renderer);
    expect(engine.positionSprings[0].getCurrentPosition()).toBeCloseTo(220, 0);
    renderer.setCurrentTime(8100);
    runToSettle(renderer);
    expect(engine.positionSprings[1].getCurrentPosition()).toBeCloseTo(220, 0);
    renderer.setCurrentTime(8600);
    runToSettle(renderer);
    expect(engine.positionSprings[2].getCurrentPosition()).toBeCloseTo(260, 0);
    renderer.dispose();
    container.remove();
  });

  it("背景行同亮不触发抬高", () => {
    const container = createContainer();
    const renderer = new LyricRenderer(container, {
      enableFloatAnimation: false,
      playing: true,
      alignPosition: 0.35,
      raiseAlignPositionOnOverlap: true,
    });
    const lines = makeLines(3);
    lines[1].isBG = true;
    renderer.setLyrics(lines);
    renderer.setCurrentTime(1000);
    runToSettle(renderer);
    const engine = renderer as unknown as {
      positionSprings: { getCurrentPosition(): number }[];
    };
    expect(engine.positionSprings[0].getCurrentPosition()).toBeCloseTo(800 * 0.35 - 20, 0);
    renderer.dispose();
    container.remove();
  });

  it("间奏圆点居中对齐，正常播放与 seek 使用同一位置", () => {
    const container = createContainer();
    const renderer = new LyricRenderer(container, {
      enableFloatAnimation: false,
      playing: true,
      alignPosition: 0.35,
    });
    const lines = makeLines(2);
    lines[0].endTime = 1000;
    lines[0].words = [{ word: "前句", startTime: 0, endTime: 1000 }];
    lines[1].startTime = 10000;
    lines[1].endTime = 14000;
    lines[1].words = [{ word: "后句", startTime: 10000, endTime: 14000 }];
    renderer.setLyrics(lines);
    const engine = renderer as unknown as {
      dotsContainerHeight: number;
      interludeState: { y: number };
    };
    engine.dotsContainerHeight = 20;
    renderer.setCurrentTime(500);
    renderer.setCurrentTime(1500);
    runToSettle(renderer);
    expect(engine.interludeState.y).toBeCloseTo(270, 0);
    renderer.setCurrentTime(8000);
    runToSettle(renderer);
    expect(engine.interludeState.y).toBeCloseTo(270, 0);
    renderer.dispose();
    container.remove();
  });

  it("快速长距离前进拖动后无重叠", () => {
    const container = createContainer();
    const renderer = new LyricRenderer(container, { enableFloatAnimation: false, playing: true });
    renderer.setLyrics(makeLines(400));

    // 正常播放一段时间，让入场动画与首行激活完成
    let time = 0;
    for (let i = 0; i < 600; i++) {
      time += 30;
      renderer.setCurrentTime(time);
      stepFrame();
    }

    // 快速长距离拖动：每帧跨越约 200 行（600s）
    for (let jump = 0; jump < 2; jump++) {
      time += 600000;
      renderer.setCurrentTime(time);
      stepFrame();
    }

    runToSettle(renderer);
    expectNoVisibleGhost(renderer);
    renderer.dispose();
  });

  it("快速长距离回退拖动后无重叠", () => {
    const container = createContainer();
    const renderer = new LyricRenderer(container, { enableFloatAnimation: false, playing: true });
    renderer.setLyrics(makeLines(400));

    let time = 1200000;
    for (let i = 0; i < 600; i++) {
      time += 30;
      renderer.setCurrentTime(time);
      stepFrame();
    }

    for (let jump = 0; jump < 2; jump++) {
      time -= 600000;
      renderer.setCurrentTime(time);
      stepFrame();
    }

    runToSettle(renderer);
    expectNoVisibleGhost(renderer);
    renderer.dispose();
  });

  it("慢速拖动（未触发 seek 阈值）后无重叠", () => {
    const container = createContainer();
    const renderer = new LyricRenderer(container, { enableFloatAnimation: false, playing: true });
    renderer.setLyrics(makeLines(400));

    let time = 0;
    for (let i = 0; i < 600; i++) {
      time += 30;
      renderer.setCurrentTime(time);
      stepFrame();
    }

    // 每帧 1500ms，低于 2000ms 的 seek 阈值，走激活/停用路径
    for (let i = 0; i < 40; i++) {
      time += 1500;
      renderer.setCurrentTime(time);
      stepFrame();
    }

    runToSettle(renderer);
    expectNoVisibleGhost(renderer);
    renderer.dispose();
  });
});
