import { createApp, h, nextTick, reactive, ref, type App } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  setAlbum: vi.fn(),
  dispose: vi.fn(),
  setImageScale: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
  resume: vi.fn(),
  pause: vi.fn(),
}));
let visibility = ref("visible");
vi.mock("@/modules/apple-music-background", () => ({
  AppleMusicBackground: class {
    update = mocks.update;
    setAlbum = mocks.setAlbum;
    dispose = mocks.dispose;
    setImageScale = mocks.setImageScale;
  },
}));
vi.mock("@/services/fftCapture", () => ({ acquireFft: mocks.acquire, releaseFft: mocks.release }));
vi.mock("@/services/playback", () => ({ getFftFrame: () => [[], []] }));
vi.mock("@vueuse/core", () => ({
  useDocumentVisibility: () => visibility,
  useRafFn: () => ({ resume: mocks.resume, pause: mocks.pause }),
}));
import Background from "./AppleMusicBackground.vue";

let app: App;
const Harness = { render: () => h(Background, props) };
let host: HTMLDivElement;
let props: {
  album: string;
  variant: "modern" | "classic";
  visible: boolean;
  playing: boolean;
  audioPlaying: boolean;
  hasLyric: boolean;
  fps: number;
  flowSpeed: number;
  renderScale: number;
  enableBeat: boolean;
};

beforeEach(() => {
  visibility = ref("visible");
  host = document.createElement("div");
  document.body.append(host);
  props = reactive({
    album: "cache://covers/a.jpg",
    variant: "modern",
    visible: true,
    playing: true,
    audioPlaying: true,
    hasLyric: true,
    fps: 30,
    flowSpeed: 4,
    renderScale: 0.5,
    enableBeat: true,
  });
});
afterEach(() => {
  app?.unmount();
  host.remove();
});

describe("Apple Music 背景 Vue 适配", () => {
  it("设置与封面同步，并在页面隐藏/卸载时配对释放 FFT", async () => {
    app = createApp(Harness);
    app.mount(host);
    expect(mocks.setAlbum).toHaveBeenCalledWith(props.album);
    expect(mocks.acquire).toHaveBeenCalledOnce();
    props.fps = 60;
    props.album = "cache://covers/b.jpg";
    await nextTick();
    expect(mocks.update.mock.lastCall![0].fps).toBe(60);
    expect(mocks.acquire).toHaveBeenCalledOnce();
    expect(mocks.setAlbum).toHaveBeenLastCalledWith(props.album);
    visibility.value = "hidden";
    await nextTick();
    expect(mocks.update.mock.lastCall![0].visible).toBe(false);
    expect(mocks.release).toHaveBeenCalledOnce();
    visibility.value = "visible";
    await nextTick();
    expect(mocks.acquire).toHaveBeenCalledTimes(2);
    app.unmount();
    expect(mocks.release).toHaveBeenCalledTimes(2);
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it("经典版不申请 FFT", () => {
    props.variant = "classic";
    app = createApp(Harness);
    app.mount(host);
    expect(mocks.acquire).not.toHaveBeenCalled();
  });

  it("暂停不冻结背景时仍停止音频采集，收起后通知渲染器不可见", async () => {
    app = createApp(Harness);
    app.mount(host);
    props.audioPlaying = false;
    await nextTick();
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.update.mock.lastCall![0].playing).toBe(true);
    props.visible = false;
    await nextTick();
    expect(mocks.update.mock.lastCall![0].visible).toBe(false);
    expect(mocks.acquire).toHaveBeenCalledOnce();
  });
});
