import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLyricTrackManagerDialog } from "@/composables/useLyricTrackManagerDialog";
import type { LyricMatchCandidate } from "@shared/types/lyrics";
import LyricTrackManagerDialog from "./LyricTrackManagerDialog.vue";

const state = vi.hoisted(() => ({
  all: vi.fn(),
  local: vi.fn(),
  source: vi.fn(),
  set: vi.fn(),
  loadForTrack: vi.fn(),
  mediaTrack: null as unknown,
  mediaDetail: null as unknown,
  preference: { source: "auto" } as { source: string; versionId?: string },
}));
vi.mock("@/stores/media", () => ({
  useMediaStore: () => ({
    get track() {
      return state.mediaTrack;
    },
    get detail() {
      return state.mediaDetail;
    },
    activeLyric: null,
    lyricContent: null,
  }),
}));
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({ lyric: { lyricSourceOrder: ["netease", "qqmusic"] } }),
}));
vi.mock("@/core/player", () => ({ playNow: vi.fn() }));
vi.mock("@/services/lyric/loader", () => ({ loadForTrack: state.loadForTrack }));
vi.mock("@/services/lyric/preference", () => ({
  getEffectiveTrackLyricPreference: async () => state.preference,
  setEffectiveTrackLyricPreference: state.set,
}));
vi.mock("@/composables/useToast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const manager = useLyricTrackManagerDialog();
const remote: LyricMatchCandidate = {
  id: "netease",
  origin: "netease",
  platform: "netease",
  format: "lrc",
  content: "[00:01]hello",
  filename: "netease.lrc",
  local: false,
  active: false,
};

const dialogStubs = {
  SDialog: { template: '<div><slot/><slot name="footer" :close="() => {}"/></div>' },
  SButton: { template: "<button><slot/></button>" },
  SPopover: { template: '<div><slot name="trigger"/><slot/></div>' },
  STag: { template: "<span><slot/></span>" },
  LyricOptimizeDialog: true,
  LyricCandidateDetails: {
    name: "LyricCandidateDetails",
    emits: ["search"],
    template: "<button @click=\"$emit('search')\">search</button>",
  },
  LyricManagerTracks: true,
  LyricSourceSearchDialog: { name: "LyricSourceSearchDialog", template: "<div />" },
  SInput: true,
  SCheckbox: true,
  IconLucideDisc3: true,
  IconLucidePlay: true,
  IconLucideRefreshCw: true,
  IconLucideSparkles: true,
  IconLucidePlus: true,
  IconLucideEllipsis: true,
};

/** 创建使用共享歌词管理 mock 的弹窗实例 */
const mountDialog = () =>
  mount(LyricTrackManagerDialog, {
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
      stubs: dialogStubs,
    },
  });

beforeEach(() => {
  manager.setOpen(false);
  state.mediaTrack = null;
  state.mediaDetail = null;
  state.preference = { source: "auto" };
  state.loadForTrack.mockReset();
  state.all.mockResolvedValue([remote]);
  state.local.mockResolvedValue([]);
  state.source.mockResolvedValue([
    { ...remote, id: "qq", origin: "qqmusic", platform: "qqmusic", filename: "qqmusic.lrc" },
  ]);
  vi.stubGlobal("api", {
    lyrics: {
      getManaged: async () => null,
      refreshManaged: async () => false,
      getTrackCandidatesLocal: state.local,
      getTrackCandidates: state.all,
      getTrackSourceCandidates: state.source,
    },
  });
});
afterEach(() => {
  manager.setOpen(false);
  vi.unstubAllGlobals();
});

describe("歌词来源列表增量缓存", () => {
  it("显示没有在线状态字段的本地 Apple Music 候选", async () => {
    const localAppleMusic: LyricMatchCandidate = {
      id: "local-apple-music",
      origin: "appleMusic",
      format: "ttml",
      content: "<tt>本地 Apple Music 歌词</tt>",
      filename: "apple-music-local.ttml",
      local: true,
      active: false,
    };
    state.local.mockResolvedValue([localAppleMusic]);
    state.all.mockResolvedValue([localAppleMusic]);

    const wrapper = mountDialog();
    try {
      manager.show({ source: "local", id: "test", title: "歌", artists: [], duration: 3000 });
      await flushPromises();
      expect(wrapper.text()).toContain("apple-music-local.ttml");
    } finally {
      wrapper.unmount();
    }
  });

  it("重新保存已选 UUID 的来源版本会重载当前主歌词但不整表获取", async () => {
    const track = {
      source: "local" as const,
      id: "test",
      title: "歌",
      artists: [],
      duration: 3000,
    };
    const detail = { id: "detail" };
    const selected: LyricMatchCandidate = {
      id: "same-uuid",
      origin: "qqmusic",
      format: "lrc",
      content: "原歌词",
      filename: "manual.lrc",
      local: true,
      active: true,
    };
    const saved = { ...selected, content: "重新保存的歌词" };
    state.mediaTrack = track;
    state.mediaDetail = detail;
    state.preference = { source: "local", versionId: selected.id };
    state.local.mockResolvedValue([selected]);
    state.all.mockResolvedValue([selected]);

    const wrapper = mountDialog();
    try {
      manager.show(track);
      await flushPromises();
      expect(state.all).toHaveBeenCalledOnce();

      await wrapper.findComponent({ name: "LyricCandidateDetails" }).get("button").trigger("click");
      const searchDialog = wrapper.findComponent({ name: "LyricSourceSearchDialog" });
      expect(searchDialog.exists()).toBe(true);
      searchDialog.vm.$emit("saved", track, saved);
      await flushPromises();

      expect(state.loadForTrack).toHaveBeenCalledExactlyOnceWith(detail);
      expect(state.all).toHaveBeenCalledOnce();
    } finally {
      wrapper.unmount();
    }
  });

  it("普通刷新保留远端候选且不再整表获取，单独获取只请求指定来源", async () => {
    const wrapper = mountDialog();
    try {
      manager.show({ source: "local", id: "test", title: "歌", artists: [], duration: 3000 });
      await flushPromises();
      expect(state.all).toHaveBeenCalledOnce();
      expect(wrapper.text()).toContain("netease.lrc");
      const details = wrapper.findComponent({ name: "LyricCandidateDetails" });
      const original = details.props("candidate");
      await wrapper.get('button[title="lyricManager.refreshLyric"]').trigger("click");
      await flushPromises();
      expect(state.local).toHaveBeenCalledTimes(2);
      expect(state.all).toHaveBeenCalledOnce();
      expect(details.props("candidate")).toBe(original);
      await wrapper
        .findAll("button")
        .find((button) => button.text() === "lyricManager.retrieve")!
        .trigger("click");
      await flushPromises();
      expect(state.source).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ id: "test" }),
        "qqmusic",
      );
      expect(state.all).toHaveBeenCalledOnce();
      expect(state.local).toHaveBeenCalledTimes(2);
      expect(wrapper.text()).toContain("netease.lrc");
      expect(wrapper.text()).toContain("qqmusic.lrc");
      expect(wrapper.text()).toContain("lyricManager.smartSelectionActive");
    } finally {
      wrapper.unmount();
    }
  });
});
