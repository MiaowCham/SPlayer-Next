import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LyricLine } from "@shared/types/lyrics";

import { nextTick } from "vue";
import { useSettingsStore } from "@/stores/settings";
import DefaultLyrics from "./DefaultLyrics.vue";
import Lyrics from "./index.vue";

vi.mock("@/stores/settings", async () => {
  const { reactive } = await import("vue");
  const settings = reactive({
    lyric: {
      engine: "physics",
      independentWordRomanizationProgress: false,
      alignment: "auto",
      springMass: 0.9,
      springDamping: 15,
      springStiffness: 90,
    },
  });
  return { useSettingsStore: () => settings };
});

const lyricGlobals = {
  stubs: { AMLLLyrics: true, LyricCredit: true },
};

const makeLine = (word: string): LyricLine => ({
  startTime: 1000,
  endTime: 2000,
  words: [{ word, startTime: 1000, endTime: 2000 }],
  translatedLyric: "译文",
  romanLyric: "",
  isBG: false,
  isDuet: false,
});

describe("默认歌词引擎配置同步", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    useSettingsStore().lyric.alignment = "auto";
    useSettingsStore().lyric.independentWordRomanizationProgress = false;
  });

  afterEach(() => vi.unstubAllGlobals());

  it("开关注音只改变展示，逐词发音和原始 ruby 可恢复", async () => {
    const source = makeLine("寂しい");
    source.words[0].ruby = [{ word: "さび", startTime: 1000, endTime: 2000 }];
    source.words[0].romanWord = "sabishii";
    const wrapper = mount(DefaultLyrics, {
      props: { lyricLines: [source], showRuby: true, showWordRomanization: true },
      global: lyricGlobals,
    });
    try {
      expect(wrapper.text()).toContain("さび");
      await wrapper.setProps({ showRuby: false });
      expect(wrapper.text()).not.toContain("さび");
      expect(wrapper.text()).toContain("sabishii");
      await wrapper.setProps({ showRuby: true });
      expect(wrapper.text()).toContain("さび");
      expect(source.words[0].ruby[0].word).toBe("さび");
    } finally {
      wrapper.unmount();
    }
  });

  it("应用歌词设置直接驱动默认引擎的水平对齐", async () => {
    const settings = useSettingsStore();
    const wrapper = mount(Lyrics, {
      props: { lyricLines: [makeLine("正文")] },
      global: lyricGlobals,
    });
    try {
      await flushPromises();
      const root = wrapper.get(".lp-root");
      expect(root.classes().filter((value) => value.startsWith("lp-align-"))).toEqual([]);
      settings.lyric.independentWordRomanizationProgress = true;
      await nextTick();
      expect(root.classes()).toContain("lp-independent-word-masks");
      settings.lyric.independentWordRomanizationProgress = false;
      await nextTick();
      expect(root.classes()).not.toContain("lp-independent-word-masks");
      settings.lyric.alignment = "center";
      await nextTick();
      expect(root.classes()).toContain("lp-align-center");
      settings.lyric.alignment = "right";
      await nextTick();
      expect(root.classes()).toContain("lp-align-right");
    } finally {
      wrapper.unmount();
    }
  });

  it("初始化和动态切换水平对齐保留原歌词 DOM，auto 恢复声部布局", async () => {
    const wrapper = mount(DefaultLyrics, {
      props: { lyricLines: [makeLine("正文")], alignment: "center" },
      global: lyricGlobals,
    });
    try {
      const original = wrapper.get(".lp-line").element;
      expect(wrapper.classes()).toContain("lp-align-center");
      for (const alignment of ["right", "left", "auto"] as const) {
        await wrapper.setProps({ alignment });
        expect(wrapper.get(".lp-line").element).toBe(original);
        const classes = wrapper.classes().filter((value) => value.startsWith("lp-align-"));
        expect(classes).toEqual(alignment === "auto" ? [] : [`lp-align-${alignment}`]);
      }
    } finally {
      wrapper.unmount();
    }
  });

  it("发音提升后仍给主发音和原文分别建立遮罩，关闭后可还原", async () => {
    const source = makeLine("窓");
    source.words[0].romanWord = "mado  ";
    source.words[0].endTime = 1500;
    source.words.push({ word: "遠", romanWord: "to", startTime: 1500, endTime: 2000 });
    const wrapper = mount(DefaultLyrics, {
      props: {
        lyricLines: [source],
        independentWordRomanizationProgress: true,
        largerLyricText: "pronunciation",
        showWordRomanization: true,
      },
      global: lyricGlobals,
    });
    try {
      expect(wrapper.get(".lp-word-text").text()).toBe("mado");
      expect(wrapper.get(".lp-roman-word").text()).toBe("窓");
      await wrapper.setProps({ largerLyricText: "lyrics" });
      expect(wrapper.get(".lp-word-text").text()).toBe("窓");
      expect(wrapper.get(".lp-roman-word").text()).toBe("mado");
      expect(wrapper.classes()).toContain("lp-independent-word-masks");
      expect(source.words[0].romanWord).toBe("mado  ");
    } finally {
      wrapper.unmount();
    }
  });

  it("冻结时缓冲歌词更换，恢复后使用最新歌词和对齐配置", async () => {
    const wrapper = mount(DefaultLyrics, {
      props: { lyricLines: [makeLine("旧歌词")] },
      global: lyricGlobals,
    });
    try {
      wrapper.vm.freeze();
      await wrapper.setProps({ lyricLines: [makeLine("新歌词")], alignment: "right" });
      expect(wrapper.get(".lp-main").text()).toBe("旧歌词");
      wrapper.vm.resume();
      expect(wrapper.get(".lp-main").text()).toBe("新歌词");
      expect(wrapper.classes()).toContain("lp-align-right");
    } finally {
      wrapper.unmount();
    }
  });
});
