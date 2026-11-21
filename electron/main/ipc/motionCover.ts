/**
 * 动态封面 IPC
 */

import { ipcMain } from "electron";
import { resolveMotionCover } from "@main/services/motionCover";
import {
  clearMotionCoverCache,
  deleteMotionCoverRecord,
  listMotionCoverRecords,
} from "@main/database/motionCoverCache";
import type { MotionCoverSource, Track } from "@shared/types/player";

export const registerMotionCoverIpc = (): void => {
  ipcMain.handle("motionCover:resolve", (_evt, track: Track, source: MotionCoverSource) =>
    resolveMotionCover(track, source),
  );
  ipcMain.handle("motionCover:listCache", () => listMotionCoverRecords());
  ipcMain.handle("motionCover:deleteCache", (_evt, fingerprint: string) =>
    deleteMotionCoverRecord(fingerprint),
  );
  ipcMain.handle("motionCover:clearCache", () => clearMotionCoverCache());
};
