import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, type VNode } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { DialogOptions } from "./useDialog";
import { useWindowControls } from "./useWindowControls";

const runtime = vi.hoisted(() => ({
  appearance: { closeAction: "hide" as "hide" | "quit", rememberCloseChoice: false },
  confirm: vi.fn<(options: DialogOptions) => Promise<boolean>>(),
}));
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({
    appearance: runtime.appearance,
    system: { system: { borderlessWindow: false } },
  }),
}));
vi.mock("./useDialog", () => ({ dialog: { confirm: runtime.confirm } }));
vi.mock("@/components/ui/SRadio.vue", () => ({ default: {} }));
vi.mock("@/components/ui/SCheckbox.vue", () => ({ default: {} }));
let wrapper: VueWrapper;
let controls: ReturnType<typeof useWindowControls>;
const hide = vi.fn();
const quit = vi.fn();

beforeEach(() => {
  runtime.appearance.closeAction = "hide";
  runtime.appearance.rememberCloseChoice = false;
  runtime.confirm.mockReset();
  vi.stubGlobal("api", {
    window: {
      hide,
      quit,
      isMaximized: async () => false,
      isFullscreen: async () => false,
      onMaximizeChange: () => () => {},
      onFullscreenChange: () => () => {},
    },
  });
  wrapper = mount(
    defineComponent({
      setup() {
        controls = useWindowControls();
        return () => h("div");
      },
    }),
    {
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
      },
    },
  );
});
afterEach(() => {
  wrapper.unmount();
  vi.unstubAllGlobals();
});

/** 读取弹窗实际渲染的单选项，避免测试另写一套选择状态。 */
const bodyNodes = (options: DialogOptions): { radios: VNode[]; checkbox: VNode } => {
  const body = options.body!() as VNode;
  const children = body.children as VNode[];
  return { radios: children[0].children as VNode[], checkbox: children[1] };
};

describe("关闭弹窗记忆选择", () => {
  it("未勾选不再询问也记住确认的选项，下次仍弹窗", async () => {
    runtime.confirm.mockImplementationOnce(async (options) => {
      const { radios } = bodyNodes(options);
      expect(radios[1].props!.checked).toBe(true);
      radios[0].props!.onChange();
      return true;
    });
    await controls.close();
    expect(quit).toHaveBeenCalledOnce();
    expect(runtime.appearance).toEqual({ closeAction: "quit", rememberCloseChoice: false });
    runtime.confirm.mockImplementationOnce(async (options) => {
      expect(bodyNodes(options).radios[0].props!.checked).toBe(true);
      return false;
    });
    await controls.close();
    expect(runtime.confirm).toHaveBeenCalledTimes(2);
  });

  it("取消不覆盖上次确认的选择，也不关闭窗口", async () => {
    runtime.confirm.mockImplementationOnce(async (options) => {
      bodyNodes(options).radios[0].props!.onChange();
      return false;
    });
    await controls.close();
    expect(runtime.appearance.closeAction).toBe("hide");
    expect(quit).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
  });

  it("勾选不再询问后按保存选项直接关闭", async () => {
    runtime.confirm.mockImplementationOnce(async (options) => {
      bodyNodes(options).checkbox.props!["onUpdate:checked"](true);
      return true;
    });
    await controls.close();
    await controls.close();
    expect(runtime.appearance.rememberCloseChoice).toBe(true);
    expect(runtime.confirm).toHaveBeenCalledOnce();
    expect(hide).toHaveBeenCalledTimes(2);
  });
});
