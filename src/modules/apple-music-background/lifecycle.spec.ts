import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gpu = vi.hoisted(() => ({
  setCover: vi.fn(),
  resize: vi.fn(),
  render: vi.fn(),
  dispose: vi.fn(),
  finishCoverTransition: vi.fn(),
}));
vi.mock("./gpu", () => ({
  BackgroundGpu: class {
    setCover = gpu.setCover;
    resize = gpu.resize;
    render = gpu.render;
    dispose = gpu.dispose;
    finishCoverTransition = gpu.finishCoverTransition;
  },
}));
import { AppleMusicBackground, type BackgroundState } from "./index";

let callbacks: Map<number, FrameRequestCallback>;
let serial: number;
let renderer: AppleMusicBackground;
let errors = vi.fn<(error: Error) => void>();
let decodes: Array<{ resolve: () => void; reject: (error: Error) => void }>;
let state: BackgroundState;

/**
 * 推进夹具时钟，只调用前一帧已经登记的回调。
 * @param time - 模拟毫秒时刻
 */
function frame(time: number): void {
  const current = [...callbacks.values()];
  callbacks.clear();
  current.forEach((callback) => callback(time));
}

beforeEach(() => {
  callbacks = new Map();
  serial = 0;
  decodes = [];
  errors = vi.fn();
  state = {
    visible: true,
    playing: true,
    hasLyrics: true,
    fps: 30,
    flowSpeed: 4,
    renderScale: 0.5,
    light: false,
  };
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      naturalWidth = 600;
      naturalHeight = 300;
      decode() {
        return new Promise<void>((resolve, reject) => decodes.push({ resolve, reject }));
      }
    },
  );
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((type: string) =>
    type === "2d" ? ({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D) : null,
  );
  const container = document.createElement("div");
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
    width: 1000,
    height: 700,
  } as DOMRect);
  document.body.appendChild(container);
  renderer = new AppleMusicBackground(container, "modern", errors);
});

afterEach(() => {
  renderer.dispose();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("背景会话生命周期", () => {
  it("没有封面不运行 RAF；解码缩略图后才开始", async () => {
    expect(callbacks.size).toBe(0);
    const loading = renderer.setAlbum("cover-a");
    decodes[0].resolve();
    await loading;
    const uploaded = gpu.setCover.mock.calls[0][0] as HTMLCanvasElement;
    expect([uploaded.width, uploaded.height]).toEqual([300, 150]);
    expect(callbacks.size).toBe(1);
    frame(100);
    expect(gpu.render).toHaveBeenCalledOnce();
  });

  it("暂停完成切歌过渡后停止；隐藏立即取消请求，恢复不补算时间", async () => {
    let loading = renderer.setAlbum("cover-a");
    decodes[0].resolve();
    await loading;
    frame(100);
    frame(200);
    renderer.update({ ...state, visible: false });
    expect(callbacks.size).toBe(0);
    renderer.update({ ...state, playing: false });
    frame(9000);
    expect(gpu.render.mock.lastCall![0].timeMs).toBe(100);
    expect(callbacks.size).toBe(0);
    loading = renderer.setAlbum("cover-b");
    decodes[1].resolve();
    await loading;
    frame(9100);
    expect(gpu.render.mock.lastCall![0].coverMix).toBe(0);
    for (let time = 9100; time < 9900; time += 17) frame(time);
    expect(gpu.render.mock.lastCall![0].coverMix).toBe(1);
    expect(callbacks.size).toBe(0);
    expect(gpu.finishCoverTransition).toHaveBeenCalled();
  });

  it("暂停时模式过渡仍绘制最终帧，低帧率也不会留下半完成状态", async () => {
    const loading = renderer.setAlbum("cover");
    decodes[0].resolve();
    await loading;
    frame(100);
    renderer.update({ ...state, playing: false, hasLyrics: false, fps: 24 });
    for (let time = 200; time < 900; time += 17) frame(time);
    expect(gpu.render.mock.lastCall![0].lyricsMix).toBe(0);
    expect(callbacks.size).toBe(0);
  });

  it("快速切歌只接受最新请求，销毁后不再上传", async () => {
    const first = renderer.setAlbum("a");
    const second = renderer.setAlbum("b");
    decodes[1].resolve();
    await second;
    decodes[0].resolve();
    await first;
    expect(gpu.setCover).toHaveBeenCalledOnce();
    const third = renderer.setAlbum("c");
    renderer.dispose();
    decodes[2].resolve();
    await third;
    expect(gpu.setCover).toHaveBeenCalledOnce();
    expect(callbacks.size).toBe(0);
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
  });

  it("解码失败报告一次且不启动空转循环", async () => {
    const loading = renderer.setAlbum("missing");
    decodes[0].reject(new Error("decode failed"));
    await loading;
    expect(errors).toHaveBeenCalledOnce();
    expect(callbacks.size).toBe(0);
  });

  it("页面隐藏和上下文丢失暂停，恢复后重传当前缩略图", async () => {
    const loading = renderer.setAlbum("cover");
    decodes[0].resolve();
    await loading;
    frame(100);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(callbacks.size).toBe(0);
    renderer.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(gpu.dispose).toHaveBeenCalledOnce();
    renderer.canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(gpu.setCover).toHaveBeenCalledTimes(2);
    expect(callbacks.size).toBe(0);
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(callbacks.size).toBe(1);
  });
});
