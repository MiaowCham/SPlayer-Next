import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import type { LyricMatchCandidate } from "@shared/types/lyrics";
import LyricPreviewDialog from "./LyricPreviewDialog.vue";

const state = vi.hoisted(() => ({
  resolve: vi.fn(),
  open: vi.fn(),
  control: vi.fn(),
  close: vi.fn(),
  unsubscribe: vi.fn(),
  getOffset: vi.fn(),
  save: vi.fn(),
  setTime: vi.fn(),
}));
vi.mock("@/services/audioSource", () => ({ resolveTrackSource: state.resolve }));
vi.mock("@/stores/status", () => ({ useStatusStore: () => ({ deviceLatencyMs: 100 }) }));
vi.mock("@/composables/useToast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const track: Track = {
  source: "local",
  id: "song",
  title: "预览曲目",
  artists: [],
  duration: 5000,
};
const candidate: LyricMatchCandidate = {
  id: "version",
  origin: "manual",
  format: "lrc",
  filename: "manual.lrc",
  content: "[00:01]word",
  local: true,
  active: false,
};

/** 挂载带有独立播放接口的预览面板 */
const create = () =>
  mount(LyricPreviewDialog, {
    props: { open: true, calibrating: true, track, candidate, lines: [] },
    global: {
      plugins: [
        createI18n({
          legacy: false,
          locale: "zh",
          messages: {},
          missingWarn: false,
          fallbackWarn: false,
        }),
      ],
      stubs: {
        SDialog: { template: '<div><slot/><slot name="footer"/></div>' },
        SButton: { props: ["disabled"], template: '<button :disabled="disabled"><slot/></button>' },
        SNumberInput: true,
        SSlider: true,
        IconLucidePlay: true,
        IconLucidePause: true,
        Lyrics: {
          setup: (_props, { expose }) => {
            expose({ setCurrentTime: state.setTime });
            return () => null;
          },
        },
      },
    },
  });
beforeEach(() => {
  state.resolve.mockReset();
  state.resolve.mockResolvedValue({ source: "track.flac" });
  state.getOffset.mockResolvedValue(250);
  state.open.mockImplementation(async (sessionId: string) => ({
    sessionId,
    ready: true,
    playing: false,
    position: 1000,
    duration: 5000,
  }));
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("api", {
    lyricPreview: {
      open: state.open,
      control: state.control,
      close: state.close.mockResolvedValue(undefined),
      onState: () => state.unsubscribe,
    },
    lyrics: { getVersionOffset: state.getOffset, setVersionOffset: state.save },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("独立试听面板", () => {
  it("读取当前版本偏移、保存草稿并在关闭时清理试听和订阅", async () => {
    const wrapper = create();
    await flushPromises();
    try {
      expect(state.open).toHaveBeenCalledWith(expect.any(String), track, "track.flac");
      expect(state.setTime).toHaveBeenLastCalledWith(1150, false);
      await wrapper
        .findAll("button")
        .find((button) => button.text() === "+100 ms")!
        .trigger("click");
      await wrapper
        .findAll("button")
        .find((button) => button.text() === "common.save")!
        .trigger("click");
      await flushPromises();
      expect(state.save).toHaveBeenCalledExactlyOnceWith(track, candidate, 350);
      expect(wrapper.emitted("update:open")).toEqual([[false]]);
      await wrapper.setProps({ open: false });
      expect(state.unsubscribe).toHaveBeenCalledOnce();
      expect(state.close).toHaveBeenCalledExactlyOnceWith(state.open.mock.calls[0][0]);
    } finally {
      wrapper.unmount();
    }
  });

  it("点击歌词先反算版本和设备偏移，定位后强制恢复跟随", async () => {
    state.control.mockImplementation(
      async (sessionId: string, _action: string, position: number) => ({
        sessionId,
        ready: true,
        playing: false,
        position,
        duration: 5000,
      }),
    );
    const wrapper = create();
    try {
      await flushPromises();
      wrapper.findComponent({ ref: "engine" }).vm.$emit("seek", 2000);
      await flushPromises();
      expect(state.control).toHaveBeenLastCalledWith(expect.any(String), "seek", 1850);
      expect(state.setTime).toHaveBeenLastCalledWith(2000, true);
    } finally {
      wrapper.unmount();
    }
  });

  it("关闭音源解析中的窗口后不再发出迟到的播放请求", async () => {
    let finish!: (source: { source: string }) => void;
    state.resolve.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const wrapper = create();
    await flushPromises();
    wrapper.unmount();
    finish({ source: "late.flac" });
    await flushPromises();
    expect(state.open).not.toHaveBeenCalled();
    expect(state.unsubscribe).toHaveBeenCalledOnce();
  });

  it("播放失败显示提示且保留当前版本的偏移校准，不启动虚假计时", async () => {
    state.resolve.mockResolvedValue(null);
    const wrapper = create();
    await flushPromises();
    try {
      expect(wrapper.text()).toContain("lyricManager.previewFailed");
      expect(state.open).not.toHaveBeenCalled();
      expect(state.control).not.toHaveBeenCalled();
      expect(wrapper.get("button").attributes("disabled")).toBeDefined();
    } finally {
      wrapper.unmount();
    }
  });
});
