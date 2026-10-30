import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LyricSearchSong } from "@shared/types/lyrics";
import LyricSourceSearchDialog from "./LyricSourceSearchDialog.vue";

const state = vi.hoisted(() => ({ search: vi.fn(), load: vi.fn(), save: vi.fn() }));
vi.mock("@/services/lyric/sourceSearch", () => ({ searchLyricVersions: state.search }));
vi.mock("@/composables/useToast", () => ({
  toast: { warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
const track = {
  source: "local" as const,
  id: "owner",
  title: "Target",
  artists: [{ name: "Singer" }],
  duration: 3000,
};
const songs: LyricSearchSong[] = [
  { id: "1", title: "Target", artists: ["Singer"], duration: 3000 },
  { id: "2", title: "Other version", artists: ["Other singer"], duration: 4000 },
];

/**
 * 挂载来源搜索面板
 * @param mode - 搜索或 ID 导入
 * @returns 测试组件
 */
const create = (mode: "search" | "id" = "search") =>
  mount(LyricSourceSearchDialog, {
    props: { open: true, source: { origin: "netease" }, track, mode },
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
        SInput: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template:
            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)"/>',
        },
        STag: { template: "<span><slot/></span>" },
        SVirtualList: {
          props: ["items"],
          template: '<div><template v-for="item in items"><slot :item="item"/></template></div>',
        },
        LyricCandidateDetails: {
          props: ["candidate"],
          template: "<div>{{ candidate.content }}</div>",
        },
        IconLucideChevronLeft: true,
        IconLucideChevronRight: true,
      },
    },
  });
beforeEach(() => {
  state.search.mockResolvedValue({ items: songs, total: 123, hasMore: true });
  state.load.mockImplementation(async (_source, song: LyricSearchSong | string) => ({
    id: typeof song === "string" ? song : song.id,
    origin: "netease",
    platform: "netease",
    content: typeof song === "string" ? song : song.title,
    format: "lrc",
    filename: "source.lrc",
    local: false,
    active: false,
  }));
  state.save.mockImplementation(async (_track, candidate) => ({
    ...candidate,
    id: "saved-uuid",
    local: true,
  }));
  vi.stubGlobal("api", {
    lyrics: { loadSourceVersion: state.load, saveSourceVersion: state.save },
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("单来源版本搜索面板", () => {
  it("展示全部模糊候选，只取选中歌词，保存时携带原目标曲目", async () => {
    const wrapper = create();
    try {
      await flushPromises();
      expect(state.search).toHaveBeenCalledExactlyOnceWith(
        { origin: "netease" },
        "Target Singer",
        0,
      );
      expect(wrapper.text()).toContain("Other version");
      expect(state.load).toHaveBeenCalledTimes(1);
      await wrapper
        .findAll("button")
        .find((button) => button.text().includes("Other version"))!
        .trigger("click");
      await flushPromises();
      expect(state.load).toHaveBeenLastCalledWith({ origin: "netease" }, songs[1]);
      await wrapper
        .findAll("button")
        .find((button) => button.text() === "lyricManager.saveSelectedVersion")!
        .trigger("click");
      await flushPromises();
      expect(state.save).toHaveBeenCalledExactlyOnceWith(
        track,
        expect.objectContaining({ id: "2" }),
      );
      expect(wrapper.emitted("saved")?.[0]).toEqual([
        track,
        expect.objectContaining({ id: "saved-uuid" }),
      ]);
    } finally {
      wrapper.unmount();
    }
  });
  it("ID 导入先展示解析结果，保存前不写文件也不发起模糊搜索", async () => {
    const wrapper = create("id");
    try {
      await wrapper.get("input").setValue("https://music.163.com/#/song?id=456");
      await wrapper
        .findAll("button")
        .find((button) => button.text() === "lyricManager.parseVersion")!
        .trigger("click");
      await flushPromises();
      expect(state.load).toHaveBeenCalledExactlyOnceWith({ origin: "netease" }, "456");
      expect(state.search).not.toHaveBeenCalled();
      expect(state.save).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("456");
    } finally {
      wrapper.unmount();
    }
  });
});
