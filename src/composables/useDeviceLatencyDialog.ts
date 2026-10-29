const open = ref(false);
/** 提供设置面板和播放侧栏共用的设备延迟入口 */
export const useDeviceLatencyDialog = () => ({
  open,
  /** 打开设备延迟管理 */
  show: (): void => {
    open.value = true;
  },
  /** 更新管理面板的显示状态
   * @param value - 是否显示
   */
  setOpen: (value: boolean): void => {
    open.value = value;
  },
});
