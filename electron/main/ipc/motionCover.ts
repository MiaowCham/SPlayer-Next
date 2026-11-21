/**
 * 动态封面 IPC
 */

import { ipcMain } from "electron";
import {
  applyManualMotionCover,
  resolveMotionCover,
  resolveMotionCoverCandidate,
  searchAmMotionCovers,
  searchNcmMotionCovers,
} from "@main/services/motionCover";
import {
  clearMotionCoverCache,
  deleteMotionCoverRecord,
  listMotionCoverRecords,
} from "@main/database/motionCoverCache";
import { clearManualMotionCover, getManualMotionCover } from "@main/database/motionCoverManual";
import type {
  MotionCoverSearchCandidate,
  MotionCoverSearchSource,
  MotionCoverSource,
  Track,
} from "@shared/types/player";

export const registerMotionCoverIpc = (): void => {
  ipcMain.handle("motionCover:resolve", (_evt, track: Track, source: MotionCoverSource) =>
    resolveMotionCover(track, source),
  );
  ipcMain.handle("motionCover:listCache", () => listMotionCoverRecords());
  ipcMain.handle("motionCover:deleteCache", (_evt, fingerprint: string) =>
    deleteMotionCoverRecord(fingerprint),
  );
  ipcMain.handle("motionCover:clearCache", () => clearMotionCoverCache());
  ipcMain.handle(
    "motionCover:search",
    (_evt, source: MotionCoverSearchSource, keyword: string, storefront: string) =>
      source === "ncm" ? searchNcmMotionCovers(keyword) : searchAmMotionCovers(keyword, storefront),
  );
  ipcMain.handle("motionCover:preview", (_evt, candidate: MotionCoverSearchCandidate) =>
    resolveMotionCoverCandidate(candidate),
  );
  ipcMain.handle(
    "motionCover:applyManual",
    (_evt, track: Track, candidate: MotionCoverSearchCandidate) =>
      applyManualMotionCover(track, candidate),
  );
  ipcMain.handle("motionCover:getManual", (_evt, track: Track) => getManualMotionCover(track));
  ipcMain.handle("motionCover:clearManual", (_evt, track: Track) => clearManualMotionCover(track));
};
