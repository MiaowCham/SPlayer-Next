import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAppleMusicBackgroundAudioAnalyzer,
  createAppleMusicBackgroundAudioSmoother,
  createAppleMusicBackgroundMesh,
  createAppleMusicBackgroundRenderer,
  fillTransparentAlbumPixels,
  getAppleMusicBackgroundBlurPassCount,
  getAppleMusicBackgroundBlurScale,
  getAppleMusicBackgroundMotion,
  getAppleMusicBackgroundPulse,
  getAppleMusicBackgroundSeed,
  isAppleMusicBackgroundBitmapUrl,
  normalizeAppleMusicBackgroundAudio,
  selectAppleMusicBackgroundPreset,
} from "./AppleMusicBackgroundRenderer";
import {
  BETA_COMPOSITE_FRAGMENT_SHADER,
  DEV_COMPOSITE_FRAGMENT_SHADER,
  DUAL_KAWASE_DOWNSAMPLE_FRAGMENT_SHADER,
  DUAL_KAWASE_UPSAMPLE_FRAGMENT_SHADER,
} from "./shaders";

const ARTWORK_TRANSITION_TEST_MS = 1800;

interface RendererHarness {
  uploads: TexImageSource[];
  setNow: (value: number) => void;
  runAnimationFrame: (value: number) => void;
  requestAnimationFrame: ReturnType<typeof vi.fn>;
  cancelAnimationFrame: ReturnType<typeof vi.fn>;
  rejectUpload: (source: TexImageSource) => void;
  restore: () => void;
}

const createRendererHarness = (): RendererHarness => {
  const uploads: TexImageSource[] = [];
  let rejectedSource: TexImageSource | undefined;
  const noOp = vi.fn();
  const texImage2D = vi.fn((...args: unknown[]) => {
    if (args[5] === rejectedSource) throw new Error("upload failed");
    if (args.length === 6) uploads.push(args[5] as TexImageSource);
  });
  const gl = new Proxy(
    {
      ARRAY_BUFFER: 0x8892,
      STATIC_DRAW: 0x88e4,
      FLOAT: 0x1406,
      TRIANGLE_STRIP: 0x0005,
      FRAMEBUFFER: 0x8d40,
      COLOR_ATTACHMENT0: 0x8ce0,
      TEXTURE_2D: 0x0de1,
      TEXTURE0: 0x84c0,
      TEXTURE_MIN_FILTER: 0x2801,
      TEXTURE_MAG_FILTER: 0x2800,
      TEXTURE_WRAP_S: 0x2802,
      TEXTURE_WRAP_T: 0x2803,
      LINEAR: 0x2601,
      CLAMP_TO_EDGE: 0x812f,
      RGBA: 0x1908,
      UNSIGNED_BYTE: 0x1401,
      VERTEX_SHADER: 0x8b31,
      FRAGMENT_SHADER: 0x8b30,
      COMPILE_STATUS: 0x8b81,
      LINK_STATUS: 0x8b82,
      COLOR_BUFFER_BIT: 0x4000,
      BLEND: 0x0be2,
      createShader: () => ({}),
      createProgram: () => ({}),
      createTexture: () => ({}),
      createFramebuffer: () => ({}),
      createBuffer: () => ({}),
      getShaderParameter: () => true,
      getProgramParameter: () => true,
      getShaderInfoLog: () => "",
      getProgramInfoLog: () => "",
      getAttribLocation: () => 0,
      getUniformLocation: () => ({}),
      getExtension: () => ({ loseContext: noOp }),
      texImage2D,
    },
    {
      get(target, property) {
        return Reflect.get(target, property) ?? noOp;
      },
    },
  ) as unknown as WebGLRenderingContext;
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(gl as never);
  class ResizeObserverMock {
    observe = vi.fn();
    disconnect = vi.fn();
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);

  let now = 0;
  const performanceNow = vi.spyOn(performance, "now").mockImplementation(() => now);
  let nextRafId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    const id = ++nextRafId;
    callbacks.set(id, callback);
    return id;
  });
  const cancelAnimationFrame = vi.fn((id: number) => callbacks.delete(id));
  vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);

  return {
    uploads,
    setNow(value) {
      now = value;
    },
    runAnimationFrame(value) {
      now = value;
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(value));
    },
    requestAnimationFrame,
    cancelAnimationFrame,
    rejectUpload(source) {
      rejectedSource = source;
    },
    restore() {
      getContext.mockRestore();
      performanceNow.mockRestore();
      vi.unstubAllGlobals();
    },
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AppleMusicBackgroundRenderer", () => {
  it("会将频谱能量约束到有效范围并清理非有限值", () => {
    expect(
      normalizeAppleMusicBackgroundAudio({
        bass: Number.NaN,
        mid: 0.4,
        high: Number.POSITIVE_INFINITY,
        transient: -1,
      }),
    ).toEqual({ bass: 0, mid: 0.4, high: 0, transient: 0 });
  });

  it("低频优先驱动脉冲，高频优先驱动材质细节", () => {
    const bass = getAppleMusicBackgroundMotion({ bass: 1, mid: 0, high: 0, transient: 0 }, 1);
    const treble = getAppleMusicBackgroundMotion({ bass: 0, mid: 0, high: 1, transient: 0 }, 1);

    expect(bass.pulse).toBeGreaterThan(treble.pulse);
    expect(treble.detail).toBeGreaterThan(bass.detail);
    expect(bass.displacement).toBeGreaterThan(treble.displacement);
  });

  it("低频对缩放脉冲的影响明显高于对流速的影响", () => {
    const idle = getAppleMusicBackgroundMotion({ bass: 0, mid: 0, high: 0, transient: 0 }, 1);
    const bass = getAppleMusicBackgroundMotion({ bass: 1, mid: 0, high: 0, transient: 0 }, 1);

    expect(bass.pulse - idle.pulse).toBeGreaterThan(0.5);
    expect(bass.flow - idle.flow).toBeLessThan(0.005);
  });

  it("默认跳动清晰可见且最大缩放脉冲保持克制", () => {
    expect(getAppleMusicBackgroundPulse(1, 1)).toBeCloseTo(0.15, 5);
    expect(getAppleMusicBackgroundPulse(1, 2.5)).toBe(0.25);
    expect(getAppleMusicBackgroundPulse(1, 10)).toBe(0.25);
  });

  it("没有频谱输入时仍保留可见的基础流动位移", () => {
    const idle = getAppleMusicBackgroundMotion({ bass: 0, mid: 0, high: 0, transient: 0 }, 1);

    expect(idle.flow).toBeGreaterThan(0);
    expect(idle.displacement).toBeGreaterThan(0);
  });

  it("会忽略负数流速", () => {
    expect(getAppleMusicBackgroundMotion({ bass: 0, mid: 0, high: 0, transient: 0 }, -1).flow).toBe(
      0,
    );
  });

  it("创建带 From/To 控制点的规则网格", () => {
    const mesh = createAppleMusicBackgroundMesh(4, 3, 2);

    expect(mesh.vertices).toHaveLength(20 * 6);
    expect(mesh.indices).toHaveLength(4 * 3 * 6);
    expect(Math.max(...mesh.indices)).toBeLessThan(20);
    expect(Array.from(mesh.vertices.slice(0, 2))).toEqual(Array.from(mesh.vertices.slice(2, 4)));
  });

  it("内部控制点使用两组强形变预设而不是规则平面", () => {
    const columns = 24;
    const rows = 16;
    const mesh = createAppleMusicBackgroundMesh(columns, rows, 1);
    let maxBaseOffset = 0;
    let maxPresetDistance = 0;
    for (let row = 1; row < rows; row++) {
      for (let column = 1; column < columns; column++) {
        const offset = (row * (columns + 1) + column) * 6;
        const baseX = (column / columns) * 2.16 - 1.08;
        const baseY = (row / rows) * 2.16 - 1.08;
        const fromX = mesh.vertices[offset];
        const fromY = mesh.vertices[offset + 1];
        const toX = mesh.vertices[offset + 2];
        const toY = mesh.vertices[offset + 3];
        maxBaseOffset = Math.max(maxBaseOffset, Math.hypot(fromX - baseX, fromY - baseY));
        maxPresetDistance = Math.max(maxPresetDistance, Math.hypot(toX - fromX, toY - fromY));
      }
    }

    expect(maxBaseOffset).toBeGreaterThan(0.18);
    expect(maxPresetDistance).toBeGreaterThan(0.25);

    for (let sample = 0; sample <= 12; sample++) {
      const phase = sample / 12;
      for (let index = 0; index < mesh.indices.length; index += 3) {
        const points = Array.from(mesh.indices.slice(index, index + 3), (vertexIndex) => {
          const offset = vertexIndex * 6;
          const baseX = (mesh.vertices[offset + 4] * 2 - 1) * 1.08;
          const baseY = (mesh.vertices[offset + 5] * 2 - 1) * 1.08;
          const x = mesh.vertices[offset] * (1 - phase) + mesh.vertices[offset + 2] * phase;
          const y = mesh.vertices[offset + 1] * (1 - phase) + mesh.vertices[offset + 3] * phase;
          return [baseX + (x - baseX) * 1.65, baseY + (y - baseY) * 1.65];
        });
        const area =
          (points[1][0] - points[0][0]) * (points[2][1] - points[0][1]) -
          (points[1][1] - points[0][1]) * (points[2][0] - points[0][0]);
        expect(area).toBeLessThan(-0.00001);
      }
    }
  });

  it("为相同封面稳定选择形变预设", () => {
    expect(selectAppleMusicBackgroundPreset("cover-a")).toBe(
      selectAppleMusicBackgroundPreset("cover-a"),
    );
    expect(selectAppleMusicBackgroundPreset("cover-a")).not.toBe(
      selectAppleMusicBackgroundPreset("cover-b"),
    );
  });

  it("低频分析器会在攻击后形成瞬态并在静音时衰减", () => {
    const analyzer = createAppleMusicBackgroundAudioAnalyzer();
    const loud = Array.from({ length: 128 }, (_, index) => (index < 24 ? 0.8 : 0));
    const loudFrame: [number[], number[]] = [loud, [...loud]];
    const first = analyzer.update(loudFrame, 50);
    const second = analyzer.update(loudFrame, 50);
    const silent = analyzer.update([[], []], 250);

    expect(first.bass).toBeGreaterThan(0);
    expect(second.transient).toBeGreaterThan(0);
    expect(silent.bass).toBeLessThan(second.bass);
  });

  it("渲染侧会平滑低频攻击和释放，避免恢复播放时突跳", () => {
    const smoother = createAppleMusicBackgroundAudioSmoother();
    const target = { bass: 1, mid: 0.8, high: 0.6, transient: 1 };
    const first = smoother.update(target, 16);
    let settled = first;
    for (let index = 0; index < 40; index++) settled = smoother.update(target, 16);
    const released = smoother.update({ bass: 0, mid: 0, high: 0, transient: 0 }, 16);

    expect(first.bass).toBeGreaterThan(0);
    expect(first.bass).toBeLessThan(0.15);
    expect(settled.bass).toBeGreaterThan(0.95);
    expect(released.bass).toBeGreaterThan(0.8);
    expect(released.bass).toBeLessThan(settled.bass);
  });

  it("Dev 使用全屏逆向 UV 强扭曲并镜像回卷，始终覆盖输出画布", () => {
    expect(DEV_COMPOSITE_FRAGMENT_SHADER).toContain("firstTwist");
    expect(DEV_COMPOSITE_FRAGMENT_SHADER).toContain("secondTwist");
    expect(DEV_COMPOSITE_FRAGMENT_SHADER).toContain("globalRotation");
    expect(DEV_COMPOSITE_FRAGMENT_SHADER).toContain("rollWeight");
    expect(DEV_COMPOSITE_FRAGMENT_SHADER).toContain("mirrorUv");
    expect(DEV_COMPOSITE_FRAGMENT_SHADER).toContain("uDistortion");
    expect(DEV_COMPOSITE_FRAGMENT_SHADER).toContain("interiorMask");
    expect(DEV_COMPOSITE_FRAGMENT_SHADER).toContain("uPulse * 0.12");
    expect(DEV_COMPOSITE_FRAGMENT_SHADER).toContain("gl_FragColor = vec4");
  });

  it("Beta 将四个封面象限分别扭曲、旋转并混合", () => {
    expect(BETA_COMPOSITE_FRAGMENT_SHADER).toContain("sampleTile(0.0");
    expect(BETA_COMPOSITE_FRAGMENT_SHADER).toContain("sampleTile(3.0");
    expect(BETA_COMPOSITE_FRAGMENT_SHADER).toContain("quadrant = vec2(0.5, 0.5)");
    expect(BETA_COMPOSITE_FRAGMENT_SHADER).toContain("rotatePoint(point - center");
    expect(BETA_COMPOSITE_FRAGMENT_SHADER).toContain("direction * phase * 0.085");
    expect(BETA_COMPOSITE_FRAGMENT_SHADER).toContain("tilePulseScale");
    expect(BETA_COMPOSITE_FRAGMENT_SHADER).toContain("transitionGradient");
  });

  it("上传前会使用最近的不透明像素填充透明区域", () => {
    const pixels = new Uint8ClampedArray([
      220, 40, 20, 255, 0, 0, 0, 0, 0, 0, 0, 0, 20, 80, 220, 255,
    ]);
    expect(fillTransparentAlbumPixels(pixels, 4, 1)).toBe(true);
    expect(Array.from(pixels.slice(4, 8))).toEqual([220, 40, 20, 255]);
    expect(Array.from(pixels.slice(8, 12))).toEqual([20, 80, 220, 255]);

    const empty = new Uint8ClampedArray(8);
    expect(fillTransparentAlbumPixels(empty, 2, 1)).toBe(true);
    expect(Array.from(empty)).toEqual([24, 22, 30, 255, 24, 22, 30, 255]);
  });

  it("透明像素按欧氏距离选择对角方向的最近颜色", () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 0, 0, 0, 0, 0, 220, 30, 40, 255, 0, 0, 0, 0, 20, 80, 230, 255, 0, 0, 0, 0,
    ]);

    expect(fillTransparentAlbumPixels(pixels, 3, 2)).toBe(true);
    expect(Array.from(pixels.slice(0, 4))).toEqual([20, 80, 230, 255]);
  });

  it("二维填充结果始终来自平方距离最小的不透明像素", () => {
    const width = 5;
    const height = 4;
    const sources = [
      { x: 0, y: 0, color: [210, 20, 30] },
      { x: 4, y: 1, color: [20, 210, 40] },
      { x: 2, y: 3, color: [30, 50, 220] },
    ] as const;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (const source of sources) {
      const offset = (source.y * width + source.x) * 4;
      pixels.set([...source.color, 255], offset);
    }

    fillTransparentAlbumPixels(pixels, width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const minimum = Math.min(
          ...sources.map((source) => (source.x - x) ** 2 + (source.y - y) ** 2),
        );
        const validColors = sources
          .filter((source) => (source.x - x) ** 2 + (source.y - y) ** 2 === minimum)
          .map((source) => source.color.join(","));
        const offset = (y * width + x) * 4;
        expect(validColors).toContain(Array.from(pixels.slice(offset, offset + 3)).join(","));
        expect(pixels[offset + 3]).toBe(255);
      }
    }
  });

  it("高模糊度增加 Dual Kawase 层数和采样偏移", () => {
    expect(getAppleMusicBackgroundBlurScale(0.5, 2)).toBeGreaterThan(
      getAppleMusicBackgroundBlurScale(0.5, 1),
    );
    expect(getAppleMusicBackgroundBlurPassCount(3)).toBe(5);
    expect(getAppleMusicBackgroundBlurPassCount(0)).toBe(2);
    expect(DUAL_KAWASE_DOWNSAMPLE_FRAGMENT_SHADER).toContain("color * 0.125");
    expect(DUAL_KAWASE_UPSAMPLE_FRAGMENT_SHADER).toContain("color / 12.0");
  });

  it("相同封面会生成稳定的动态布局种子", () => {
    expect(getAppleMusicBackgroundSeed("cover-a")).toBe(getAppleMusicBackgroundSeed("cover-a"));
    expect(getAppleMusicBackgroundSeed("cover-a")).not.toBe(getAppleMusicBackgroundSeed("cover-b"));
  });

  it("本地与流媒体封面协议优先使用可上传的 ImageBitmap", () => {
    expect(isAppleMusicBackgroundBitmapUrl("cache://covers/local.jpg")).toBe(true);
    expect(isAppleMusicBackgroundBitmapUrl("streaming-cover://image?id=1")).toBe(true);
    expect(isAppleMusicBackgroundBitmapUrl("https://example.com/cover.jpg")).toBe(false);
  });

  it("连续切歌会等待当前交叉淡化完成后再上传最新封面", async () => {
    const harness = createRendererHarness();
    const renderer = createAppleMusicBackgroundRenderer();
    renderer.mount(document.createElement("div"));
    const first = document.createElement("canvas");
    const second = document.createElement("canvas");
    const latest = document.createElement("canvas");

    await expect(renderer.updateAlbum(first)).resolves.toBe(true);
    await expect(renderer.updateAlbum(second)).resolves.toBe(true);
    await expect(renderer.updateAlbum(latest)).resolves.toBe(true);
    expect(harness.uploads).toEqual([first, second]);

    harness.runAnimationFrame(1000);
    expect(harness.uploads).toEqual([first, second]);
    harness.runAnimationFrame(ARTWORK_TRANSITION_TEST_MS);
    expect(harness.uploads).toEqual([first, second, latest]);
    expect(harness.requestAnimationFrame).toHaveBeenCalledTimes(3);
    renderer.dispose();
    harness.restore();
  });

  it("隐藏时会停止 RAF，恢复可见后才继续渲染", () => {
    const harness = createRendererHarness();
    const renderer = createAppleMusicBackgroundRenderer();
    renderer.mount(document.createElement("div"));
    renderer.setPlaying(true);
    expect(harness.requestAnimationFrame).toHaveBeenCalledTimes(1);

    renderer.setVisible(false);
    expect(harness.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    harness.runAnimationFrame(250);
    expect(harness.requestAnimationFrame).toHaveBeenCalledTimes(1);

    renderer.setVisible(true);
    expect(harness.requestAnimationFrame).toHaveBeenCalledTimes(2);
    renderer.dispose();
    harness.restore();
  });

  it("隐藏期间的新封面会替换可见阶段排队的旧封面", async () => {
    const harness = createRendererHarness();
    const renderer = createAppleMusicBackgroundRenderer();
    renderer.mount(document.createElement("div"));
    const first = document.createElement("canvas");
    const second = document.createElement("canvas");
    const stale = document.createElement("canvas");
    const latest = document.createElement("canvas");
    await renderer.updateAlbum(first);
    await renderer.updateAlbum(second);
    await renderer.updateAlbum(stale);

    renderer.setVisible(false);
    await renderer.updateAlbum(latest);
    renderer.setVisible(true);
    harness.runAnimationFrame(ARTWORK_TRANSITION_TEST_MS);
    expect(harness.uploads).toEqual([first, second, latest]);
    renderer.dispose();
    harness.restore();
  });

  it("WebGL context 恢复后会重新上传当前封面", async () => {
    const harness = createRendererHarness();
    const renderer = createAppleMusicBackgroundRenderer();
    renderer.mount(document.createElement("div"));
    const album = document.createElement("canvas");
    await expect(renderer.updateAlbum(album)).resolves.toBe(true);

    const canvas = renderer.getElement();
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(harness.uploads).toEqual([album, album]);
    renderer.dispose();
    harness.restore();
  });

  it("ImageBitmap 上传异常时会立即释放解码位图", async () => {
    const harness = createRendererHarness();
    class ImageBitmapMock {
      width = 300;
      height = 300;
      close = vi.fn();
    }
    const bitmap = new ImageBitmapMock();
    vi.stubGlobal("ImageBitmap", ImageBitmapMock);
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob()) }),
    );
    vi.spyOn(HTMLImageElement.prototype, "decode").mockRejectedValue(new Error("decode failed"));
    harness.rejectUpload(bitmap as unknown as ImageBitmap);
    const renderer = createAppleMusicBackgroundRenderer();
    renderer.mount(document.createElement("div"));

    await expect(renderer.updateAlbum("cache://covers/failure.png")).resolves.toBe(false);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    renderer.dispose();
    harness.restore();
  });

  it("协议封面位图不在解码阶段预先翻转", async () => {
    const harness = createRendererHarness();
    class ImageBitmapMock {
      width = 300;
      height = 300;
      close = vi.fn();
    }
    const bitmap = new ImageBitmapMock();
    const createBitmap = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal("ImageBitmap", ImageBitmapMock);
    vi.stubGlobal("createImageBitmap", createBitmap);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob()) }),
    );
    const renderer = createAppleMusicBackgroundRenderer();
    renderer.mount(document.createElement("div"));

    await expect(renderer.updateAlbum("cache://covers/local.png")).resolves.toBe(true);
    expect(createBitmap).toHaveBeenCalledWith(expect.any(Blob));
    renderer.dispose();
    harness.restore();
  });

  it("动态画布自身声明完整覆盖层级", () => {
    const renderer = createAppleMusicBackgroundRenderer();
    const canvas = renderer.getElement();

    expect(canvas.style.position).toBe("absolute");
    expect(canvas.style.cssText).toContain("inset: 0");
    expect(canvas.style.zIndex).toBe("1");
    renderer.dispose();
  });
});
