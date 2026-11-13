/**
 * Apple Music 相关 IPC
 *
 * - search：按分类搜索 Apple Music 目录（iTunes Search API）
 */
import { ipcMain } from "electron";
import type { AppleMusicSearchParams } from "@shared/types/appleMusic";
import { searchAppleMusic } from "@main/services/appleMusicSearch";

export const registerAppleMusicIpc = (): void => {
  ipcMain.handle("appleMusic:search", (_evt, params: AppleMusicSearchParams) =>
    searchAppleMusic(params),
  );
};
