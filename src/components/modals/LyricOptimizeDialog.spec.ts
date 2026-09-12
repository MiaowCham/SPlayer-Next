import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import LyricOptimizeDialog from "./LyricOptimizeDialog.vue";
import STabs from "@/components/ui/STabs.vue";
import { useLyricOptimizeDialog } from "@/composables/useLyricOptimizeDialog";
import type { LyricMatchCandidate } from "@shared/types/lyrics";
import { normalizeTtml } from "@shared/utils/ttml";

vi.mock("@/composables/useToast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/composables/useDialog", () => ({ dialog: { confirm: vi.fn(async () => true) } }));
let wrapper: VueWrapper | undefined;
const optimize = useLyricOptimizeDialog();
afterEach(() => {
  wrapper?.unmount();
  optimize.setOpen(false);
  vi.unstubAllGlobals();
});

describe("歌词优化真实 Tab 与保存", () => {
  it("格式化文件原样进入美化页，切换原始页并保存紧凑 TTML", async () => {
    const content = `<tt xmlns="http://www.w3.org/ns/ttml">\n<body><div><p begin="0s" end="2s">\n<span begin="0s" end="1s">Hello </span>\n<span begin="1s" end="2s">world</span>\n</p></div></body>\n</tt>`;
    const candidate: LyricMatchCandidate = {
      id: "test",
      origin: "manual",
      format: "ttml",
      filename: "test.ttml",
      content,
      local: false,
      active: false,
    };
    optimize.show(
      { id: "1", source: "netease", title: "test", artists: [], duration: 2000 },
      candidate,
    );
    const save = vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true);
    vi.stubGlobal("api", { lyrics: { saveOptimizedLyric: save } });
    wrapper = mount(LyricOptimizeDialog, {
      global: {
        plugins: [
          createI18n({
            legacy: false,
            locale: "en",
            missingWarn: false,
            fallbackWarn: false,
            messages: {},
          }),
        ],
        components: { STabs },
        stubs: {
          SDialog: { template: '<div><slot/><slot name="footer" :close="() => {}"/></div>' },
          SButton: { template: "<button><slot/></button>" },
        },
      },
    });
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(2);
    expect(wrapper.get("textarea").element.value).toBe(content);
    await wrapper.findAll('[role="tab"]')[0].trigger("click");
    expect(wrapper.get("textarea").element.value).toBe(normalizeTtml(content).content);
    await wrapper.findAll('[role="tab"]')[1].trigger("click");
    await wrapper.findAll("button").at(-1)!.trigger("click");
    await flushPromises();
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][2]).toEqual({
      content: normalizeTtml(content).content,
      translation: undefined,
      romaji: undefined,
    });
  });
});
