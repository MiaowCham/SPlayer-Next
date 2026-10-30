import { app, ipcMain } from "electron";
import type { Track } from "@shared/types/player";
import { getMainWindow } from "@main/window";
import {
  closeLyricPreview,
  controlLyricPreview,
  openLyricPreview,
} from "@main/services/lyricPreview";

/** 注册仅主窗口可访问的独立试听通道，并在窗口退出时释放资源 */
export const registerLyricPreviewIpc = (): void => {
  let currentId: string | undefined;
  let detach: (() => void) | undefined;
  /**
   * 释放当前拥有者的生命周期监听和试听
   * @param sessionId - 可选的会话身份
   */
  const close = (sessionId?: string): void => {
    if (sessionId && sessionId !== currentId) return;
    currentId = undefined;
    closeLyricPreview(sessionId);
    detach?.();
    detach = undefined;
  };
  ipcMain.handle("lyricPreview:open", async (event, id: string, track: Track, source: string) => {
    const owner = getMainWindow();
    if (!owner || event.sender !== owner.webContents) throw new Error("试听窗口不可用");
    close();
    currentId = id;
    /** 关闭或重载页面时停止试听并恢复被暂停的主播放 */
    const cleanup = (): void => close(id);
    owner.once("hide", cleanup);
    owner.webContents.once("destroyed", cleanup);
    owner.webContents.once("render-process-gone", cleanup);
    owner.webContents.once("did-start-loading", cleanup);
    detach = () => {
      owner.removeListener("hide", cleanup);
      owner.webContents.removeListener("destroyed", cleanup);
      owner.webContents.removeListener("render-process-gone", cleanup);
      owner.webContents.removeListener("did-start-loading", cleanup);
    };
    return openLyricPreview(id, track, source, (state) => {
      if (!owner.isDestroyed() && owner.isVisible() && !event.sender.isDestroyed()) {
        event.sender.send("lyricPreview:state", state);
      }
    });
  });
  ipcMain.handle(
    "lyricPreview:control",
    (event, id: string, action: "play" | "pause" | "seek", value?: number) => {
      if (event.sender !== getMainWindow()?.webContents) throw new Error("试听窗口不可用");
      return controlLyricPreview(id, action, value);
    },
  );
  ipcMain.handle("lyricPreview:close", (event, id: string) => {
    if (event.sender === getMainWindow()?.webContents) close(id);
  });
  app.once("before-quit", () => {
    detach?.();
    closeLyricPreview(undefined, false);
  });
};
