// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JsCaptureEvent } from "@splayer/audio-capture";

const runtime = vi.hoisted(() => ({
  callbacks: [] as Array<(event: JsCaptureEvent) => void>,
  cancels: [] as Array<ReturnType<typeof vi.fn>>,
  broadcast: vi.fn(),
  play: vi.fn(async () => {}),
  pause: vi.fn(),
  fingerprint: vi.fn(async () => ({ ok: true, fingerprint: "test" })),
  match: vi.fn(async () => ({ ok: true, songs: [] })),
}));

vi.mock("@main/utils/nativeLoader", () => ({
  loadNativeModule: () => ({
    AudioCaptureSession: class {
      cancel = vi.fn();
      /** 登记测试会话的取消操作 */
      constructor() {
        runtime.cancels.push(this.cancel);
      }
      /** 返回测试采集支持状态 */
      isSupported() {
        return true;
      }
      /** 保存当前会话的回调以模拟原生线程延迟事件
       * @param _config - 采集配置
       * @param callback - 原生事件回调
       */
      start(_config: unknown, callback: (event: JsCaptureEvent) => void) {
        runtime.callbacks.push(callback);
      }
    },
  }),
}));
vi.mock("@main/utils/broadcast", () => ({ broadcast: runtime.broadcast }));
vi.mock("@main/services/engine", () => ({
  getPlayer: () => ({
    getStatus: () => ({ state: "playing" }),
    play: runtime.play,
    pause: runtime.pause,
  }),
}));
vi.mock("@main/utils/logger", () => ({
  recognitionLog: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("./fingerprint", () => ({
  isAfpAvailable: () => true,
  fingerprintPcm: runtime.fingerprint,
}));
vi.mock("./match", () => ({ matchAudio: runtime.match }));
import { startRecognition, cancelRecognition, submitPcm } from "./session";

beforeEach(() => {
  cancelRecognition();
  vi.clearAllMocks();
  runtime.callbacks.length = 0;
  runtime.cancels.length = 0;
});

describe("识曲会话隔离", () => {
  it.each(["level", "error", "done", "data"])("忽略取消会话晚到的 %s 事件", async (kind) => {
    startRecognition({ source: "system", durationMs: 8000 });
    const old = runtime.callbacks[0];
    cancelRecognition();
    startRecognition({ source: "system", durationMs: 8000 });
    vi.clearAllMocks();
    old(
      kind === "data"
        ? { eventType: "done", data: Buffer.from(new Float32Array(24000).fill(0.1).buffer) }
        : ({
            eventType: kind,
            level: 0.5,
            errorCode: "capture-failed",
            error: "old",
          } as JsCaptureEvent),
    );
    await vi.waitFor(() => expect(runtime.fingerprint).not.toHaveBeenCalled());
    expect(runtime.broadcast).not.toHaveBeenCalled();
    expect(runtime.play).not.toHaveBeenCalled();
    cancelRecognition();
    expect(runtime.cancels[1]).toHaveBeenCalledOnce();
    expect(runtime.play).toHaveBeenCalledOnce();
  });

  it("当前会话仍能推送音量、完成匹配并恢复播放", async () => {
    startRecognition({ source: "system", durationMs: 8000 });
    runtime.callbacks[0]({ eventType: "level", level: 0.5 });
    expect(runtime.broadcast).toHaveBeenCalledWith(
      "recognition:event",
      { phase: "capturing", level: 0.5 },
      true,
    );
    runtime.callbacks[0]({
      eventType: "done",
      data: Buffer.from(new Float32Array(24000).fill(0.1).buffer),
    });
    await vi.waitFor(() => expect(runtime.match).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(runtime.play).toHaveBeenCalledOnce());
    expect(runtime.broadcast).toHaveBeenCalledWith(
      "recognition:event",
      { phase: "done", candidates: [] },
      false,
    );
    vi.clearAllMocks();
    runtime.callbacks[0]({ eventType: "level", level: 0.8 });
    expect(runtime.broadcast).not.toHaveBeenCalled();
  });

  it("提交麦克风数据时取消原生采集，旧回调不能影响匹配", async () => {
    startRecognition({ source: "system", durationMs: 8000 });
    const old = runtime.callbacks[0];
    submitPcm(new Float32Array(24000).fill(0.1));
    expect(runtime.cancels[0]).toHaveBeenCalledOnce();
    old({ eventType: "error", error: "old" });
    await vi.waitFor(() => expect(runtime.match).toHaveBeenCalledOnce());
    expect(runtime.broadcast.mock.calls.some(([, event]) => event.phase === "error")).toBe(false);
  });
});
