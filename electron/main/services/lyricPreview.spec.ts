import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import type { AudioPlayer, JsPlayerEvent } from "@splayer/audio-engine";
import { getPlayer } from "@main/services/engine";

const state = vi.hoisted(() => ({
  mainState: "playing",
  mainPosition: 17,
  track: { source: "local", id: "main", serverId: undefined as string | undefined },
  prepare: vi.fn(),
  load: vi.fn(),
  mainPlay: vi.fn(),
  mainPause: vi.fn(),
  instances: [] as Array<{
    event: (event: JsPlayerEvent) => void;
    position: number;
    state: string;
    stopped: boolean;
    seeks: number[];
  }>,
}));
vi.mock("@main/services/engine", () => {
  const main = {
    getStatus: () => ({ state: state.mainState, position: state.mainPosition }),
    getPosition: () => state.mainPosition,
    pauseImmediately: () => {
      state.mainState = "paused";
      state.mainPause();
    },
    play: async () => {
      state.mainState = "playing";
      state.mainPlay();
    },
  };
  class PreviewPlayer {
    event = (_event: JsPlayerEvent): void => {};
    position = 0;
    state = "paused";
    stopped = false;
    seeks: number[] = [];
    /** 记录测试使用的独立实例 */
    constructor() {
      state.instances.push(this);
    }
    /** 读取测试播放状态 */
    getStatus() {
      return { state: this.state, position: this.position };
    }
    /** 读取秒进度 */
    getPosition() {
      return this.position;
    }
    /** 替换原生回调 */
    onEvent(callback: (event: JsPlayerEvent) => void) {
      this.event = callback;
    }
    /** 停止测试实例 */
    stop() {
      this.stopped = true;
      this.state = "stopped";
    }
    /** 加载测试音源 */
    async load(source: string, autoPlay: boolean) {
      await state.load(source, autoPlay);
      return { duration: 120 };
    }
    /** 定位独立实例 */
    async seek(position: number) {
      this.position = position;
      this.seeks.push(position);
    }
    /** 开始独立播放 */
    async play() {
      this.state = "playing";
    }
    /** 立即暂停独立实例 */
    pauseImmediately() {
      this.state = "paused";
    }
    /** 测试实例不产生淡化 */
    setFadeDuration() {
      return undefined;
    }
    /** 测试实例不产生频谱 */
    setFftEnabled() {
      return undefined;
    }
    /** 测试音量设置 */
    setVolume() {
      return undefined;
    }
    /** 测试输出设置 */
    async setOutputDevice() {
      return undefined;
    }
  }
  return { getPlayer: () => main, getEngine: () => ({ AudioPlayer: PreviewPlayer }) };
});
vi.mock("@main/services/nowPlaying", () => ({ lightSnapshot: () => ({ track: state.track }) }));
vi.mock("@main/services/streaming/playback", () => ({ prepareStreamingPlayback: state.prepare }));
vi.mock("@main/store", () => ({ store: { get: () => 1 } }));
vi.mock("@main/utils/logger", () => ({ playerLog: { warn: vi.fn() } }));

const track: Track = {
  id: "preview",
  source: "local",
  title: "试听",
  artists: [],
  duration: 120000,
};

beforeEach(() => {
  vi.resetModules();
  state.mainState = "playing";
  state.mainPosition = 17;
  state.track = { source: "local", id: "main", serverId: undefined };
  state.instances = [];
  state.load.mockReset();
  state.prepare.mockReset();
});

describe("歌词试听与主播放的互斥及生命周期", () => {
  it("真正开始试听时暂停主播放，关闭后恢复，定位只影响子实例", async () => {
    const service = await import("./lyricPreview");
    const received = vi.fn();
    const result = await service.openLyricPreview("one", track, "song.flac", received);
    expect(state.load).toHaveBeenCalledWith("song.flac", false);
    expect(result).toMatchObject({ ready: true, playing: true });
    expect(state.mainPause).toHaveBeenCalledOnce();
    await service.controlLyricPreview("one", "seek", 23456);
    expect(state.instances[0].seeks).toEqual([23.456]);
    expect(state.mainPosition).toBe(17);
    await service.controlLyricPreview("one", "pause");
    expect(state.mainPlay).not.toHaveBeenCalled();
    service.closeLyricPreview("one");
    expect(state.mainPlay).toHaveBeenCalledOnce();
    expect(state.instances[0].stopped).toBe(true);
    state.instances[0].event({ type: "position" });
    expect(received).not.toHaveBeenCalled();
  });

  it("原本暂停的主播放在试听关闭时保持暂停", async () => {
    state.mainState = "paused";
    const service = await import("./lyricPreview");
    await service.openLyricPreview("one", track, "song.flac", vi.fn());
    service.closeLyricPreview();
    expect(state.mainPause).not.toHaveBeenCalled();
    expect(state.mainPlay).not.toHaveBeenCalled();
  });

  it.each(["manual", "seek", "quit"])("%s 后放弃自动恢复", async (action) => {
    const service = await import("./lyricPreview");
    await service.openLyricPreview("one", track, "song.flac", vi.fn());
    if (action === "manual") service.cancelPreviewMainResume();
    if (action === "seek") state.mainPosition = 30;
    service.closeLyricPreview(undefined, action !== "quit");
    expect(state.mainPlay).not.toHaveBeenCalled();
  });

  it("主加载迟到播放时暂停并在关闭试听后恢复，即使曲目快照更新", async () => {
    state.mainState = "paused";
    const service = await import("./lyricPreview");
    await service.openLyricPreview("one", track, "song.flac", vi.fn());
    state.mainState = "playing";
    expect(service.pauseMainForPreview(getPlayer() as AudioPlayer)).toBe(true);
    expect(state.mainState).toBe("paused");
    state.track.id = "loaded";
    service.closeLyricPreview("one");
    expect(state.mainPlay).toHaveBeenCalledOnce();
  });

  it("迟到的主播放被拦截后，用户控制会撤销恢复权", async () => {
    state.mainState = "paused";
    const service = await import("./lyricPreview");
    await service.openLyricPreview("one", track, "song.flac", vi.fn());
    state.mainState = "playing";
    service.pauseMainForPreview(getPlayer() as AudioPlayer);
    service.cancelPreviewMainResume();
    expect(state.instances[0].state).toBe("paused");
    service.closeLyricPreview("one");
    expect(state.mainPlay).not.toHaveBeenCalled();
  });

  it("流媒体只解析鉴权音源，不建立主播放上报会话", async () => {
    state.prepare.mockResolvedValue({ url: "https://server/private-audio", sessionId: "isolated" });
    const service = await import("./lyricPreview");
    await service.openLyricPreview(
      "one",
      { ...track, source: "streaming", serverId: "server", originalId: "song" },
      "streaming://song",
      vi.fn(),
    );
    expect(state.load).toHaveBeenCalledWith("https://server/private-audio", false);
    service.closeLyricPreview();
  });

  it("关闭加载中的试听后不会迟到播放或暂停主播放", async () => {
    let finish!: () => void;
    state.load.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const service = await import("./lyricPreview");
    const pending = service.openLyricPreview("one", track, "song.flac", vi.fn());
    await vi.waitFor(() => expect(state.load).toHaveBeenCalled());
    service.closeLyricPreview("one");
    finish();
    await pending;
    expect(state.mainPause).not.toHaveBeenCalled();
    expect(state.instances[0].state).toBe("stopped");
  });

  it("旧会话的关闭和操作不会影响新试听", async () => {
    const service = await import("./lyricPreview");
    await service.openLyricPreview("old", track, "song.flac", vi.fn());
    await service.openLyricPreview("new", track, "song.flac", vi.fn());
    service.closeLyricPreview("old");
    expect(await service.controlLyricPreview("old", "pause")).toBeNull();
    expect(state.instances[1].state).toBe("playing");
    service.closeLyricPreview("new");
  });

  it("CUE 进度相对于分轨起点，抵达分轨终点暂停", async () => {
    const service = await import("./lyricPreview");
    const send = vi.fn();
    const result = await service.openLyricPreview(
      "cue",
      { ...track, cueStartMs: 10000, cueEndMs: 20000 },
      "disc.flac",
      send,
    );
    expect(result).toMatchObject({ position: 0, duration: 10000 });
    await service.controlLyricPreview("cue", "seek", 4000);
    expect(state.instances[0].position).toBe(14);
    state.instances[0].position = 20;
    state.instances[0].event({ type: "position" });
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ position: 10000, playing: false }),
    );
    service.closeLyricPreview();
  });

  it("加载失败不暂停原播放且释放实例", async () => {
    state.load.mockRejectedValue(new Error("bad source"));
    const service = await import("./lyricPreview");
    expect(await service.openLyricPreview("one", track, "bad.flac", vi.fn())).toMatchObject({
      ready: false,
      playing: false,
      error: "previewFailed",
    });
    expect(state.mainPause).not.toHaveBeenCalled();
    expect(state.instances[0].stopped).toBe(true);
  });
});
