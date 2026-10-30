import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { describe, expect, it, vi } from "vitest";
import { parseLyric } from "@/utils/lyric/parse";
import type { Track } from "@shared/types/player";
import CopyLyricsDialog from "./CopyLyricsDialog.vue";

const state = vi.hoisted(() => ({ copy: vi.fn() }));
vi.mock("@/stores/media", () => ({
  useMediaStore: () => ({
    track: { title: "主播放曲目", artists: [] },
    parsedLyric: [{ words: [{ word: "主播放歌词" }] }],
    lyricContent: { content: "主播放原文" },
  }),
}));
vi.mock("@/stores/theme", () => ({ useThemeStore: () => ({}) }));
vi.mock("@/stores/settings", () => ({ useSettingsStore: () => ({}) }));
vi.mock("@/composables/useCopyText", () => ({ useCopyText: () => ({ copy: state.copy }) }));
vi.mock("@/utils/lyric/poster", () => ({ createLyricPoster: vi.fn() }));

describe("选择复制的歌词版本覆盖", () => {
  it("展示、正文、原文与歌曲后缀均使用传入版本，切换版本后重新全选", async () => {
    const lines = parseLyric(
      { content: "[00:01]面板正文", translation: "[00:01]面板译文", translationFormat: "lrc" },
      "lrc",
    );
    const wrapper = mount(CopyLyricsDialog, {
      props: {
        open: true,
        track: { title: "面板曲目", artists: [{ name: "歌手" }] } as Track,
        lyricLines: lines,
        rawContent: "[00:01]面板正文",
      },
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
          SButton: { template: "<button><slot/></button>" },
          SCheckbox: { template: "<label><slot/></label>" },
          SCheckboxGroup: { template: "<div><slot/></div>" },
        },
      },
    });
    try {
      expect(wrapper.text()).toContain("面板正文");
      expect(wrapper.text()).toContain("面板译文");
      expect(wrapper.text()).not.toContain("主播放歌词");
      await wrapper.setProps({ open: false });
      await wrapper.setProps({ open: true });
      const copy = wrapper
        .findAll("button")
        .find((button) => button.text() === "player.copyLyric.copy")!;
      await copy.trigger("click");
      await flushPromises();
      expect(state.copy).toHaveBeenLastCalledWith("面板正文\n面板译文\n——《面板曲目》 - 歌手");
      await wrapper
        .findAll("button")
        .find((button) => button.text() === "player.copyLyric.copyRaw")!
        .trigger("click");
      expect(state.copy).toHaveBeenLastCalledWith("[00:01]面板正文");
      await wrapper.setProps({
        lyricLines: parseLyric({ content: "[00:02]新版本" }, "lrc"),
        rawContent: "[00:02]新版本",
      });
      await copy.trigger("click");
      expect(state.copy).toHaveBeenLastCalledWith("新版本\n——《面板曲目》 - 歌手");
    } finally {
      wrapper.unmount();
    }
  });
});
