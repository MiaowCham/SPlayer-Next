import { flushPromises, mount } from "@vue/test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  settings: {
    experimental: { enabled: false },
  },
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@/apis/github", () => ({
  getContributors: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/composables/useCopyText", () => ({
  useCopyText: () => ({ copy: vi.fn() }),
}));

vi.mock("@/composables/useDialog", () => ({
  dialog: { confirm: mocks.confirm },
}));

vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => mocks.settings,
}));

vi.mock("@/stores/update", () => ({
  useUpdateStore: () => ({
    phase: "idle",
    hasUpdate: false,
    openDialog: vi.fn(),
    checkManually: vi.fn(),
  }),
}));

vi.mock("@/utils/url", () => ({
  openExternal: vi.fn(),
}));

let AboutSettings: (typeof import("./AboutSettings.vue"))["default"];

beforeAll(async () => {
  Object.defineProperty(window, "electron", {
    configurable: true,
    value: { process: { versions: { electron: "1", chrome: "1", node: "1", v8: "1" } } },
  });
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      system: {
        platform: "win32",
        osInfo: { type: "Windows", arch: "x64", release: "test" },
        openLogsDir: vi.fn(),
      },
    },
  });
  AboutSettings = (await import("./AboutSettings.vue")).default;
});

beforeEach(() => {
  mocks.settings.experimental.enabled = false;
  mocks.confirm.mockReset();
  mocks.confirm.mockResolvedValue(true);
});

describe("实验性选项解锁", () => {
  it("连续点击应用信息区域 7 次后显示警告并启用", async () => {
    const wrapper = mount(AboutSettings, {
      global: {
        stubs: {
          SCard: { template: "<div><slot /></div>" },
          SLogo: true,
          STag: { template: "<span><slot /></span>" },
          SButton: { template: "<button><slot name='icon' /><slot /></button>" },
          SImg: true,
        },
      },
    });
    const unlockArea = wrapper.get('[data-testid="experimental-unlock-area"]');

    for (let index = 0; index < 6; index += 1) await unlockArea.trigger("click");
    expect(mocks.confirm).not.toHaveBeenCalled();

    await unlockArea.trigger("click");
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "settings.experimentalUnlock.title",
        content: "settings.experimentalUnlock.content",
        type: "warning",
      }),
    );
    await flushPromises();
    expect(mocks.settings.experimental.enabled).toBe(true);
  });
});
