import { mount } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { SettingItem } from "@/types/settings-schema";
import SettingsItem from "./SettingsItem.vue";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@/settings/useSettingModel", () => ({
  useSettingModel: () => ({ value: undefined }),
}));

vi.mock("@/composables/useDialog", () => ({
  dialog: { confirm: vi.fn() },
}));

describe("SettingsItem 子项显示", () => {
  it("hideChildren 启用时按条件从 DOM 中添加和移除子项", async () => {
    const childrenActive = ref(false);
    const item: SettingItem = {
      key: "parent",
      type: "select",
      hideChildren: true,
      childrenCondition: () => childrenActive.value,
      children: [{ key: "child", type: "switch" }],
    };
    const wrapper = mount(SettingsItem, {
      props: { item },
      global: {
        stubs: {
          SSelect: true,
          SSwitch: true,
        },
      },
    });

    expect(wrapper.find("#setting-child").exists()).toBe(false);
    childrenActive.value = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.find("#setting-child").exists()).toBe(true);
    childrenActive.value = false;
    await wrapper.vm.$nextTick();
    expect(wrapper.find("#setting-child").exists()).toBe(false);
  });

  it("响应式过滤带 visible 条件的选择项", async () => {
    const experimentalVisible = ref(false);
    const item: SettingItem = {
      key: "background",
      type: "select",
      options: [
        { value: "blur", label: "Blur" },
        { value: "experimental", label: "Experimental", visible: () => experimentalVisible.value },
      ],
    };
    const SelectStub = defineComponent({
      name: "SSelect",
      props: { options: { type: Array, default: () => [] } },
      template: '<div data-testid="select" />',
    });
    const wrapper = mount(SettingsItem, {
      props: { item },
      global: {
        stubs: { SSelect: SelectStub },
      },
    });

    expect(wrapper.findComponent(SelectStub).props("options")).toEqual([
      { value: "blur", label: "Blur" },
    ]);
    experimentalVisible.value = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(SelectStub).props("options")).toEqual([
      { value: "blur", label: "Blur" },
      { value: "experimental", label: "Experimental" },
    ]);
  });
});
