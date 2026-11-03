/**
 * Apple Music 相关 IPC
 *
 * - search：按分类搜索 Apple Music 目录（iTunes Search API）
 */
import { ipcMain } from "electron";
import type { AppleMusicMotionParams, AppleMusicSearchParams } from "@shared/types/appleMusic";
import {
  getAppleMusicMotionCover,
  invalidateAppleMusicMotionCover,
} from "@main/services/appleMusicMotion";
import { searchAppleMusic } from "@main/services/appleMusicSearch";

export const registerAppleMusicIpc = (): void => {
  ipcMain.handle("appleMusic:search", (_evt, params: AppleMusicSearchParams) =>
    searchAppleMusic(params),
  );
  ipcMain.handle("appleMusic:motion", (_evt, params: AppleMusicMotionParams) =>
    getAppleMusicMotionCover(params),
  );
  ipcMain.on("appleMusic:motionInvalidate", (_evt, params: AppleMusicMotionParams) =>
    invalidateAppleMusicMotionCover(params),
  );
};
