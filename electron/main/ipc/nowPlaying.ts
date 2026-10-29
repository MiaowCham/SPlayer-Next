import { ipcMain } from "electron";
import { getMainWindow } from "@main/window";
import { broadcast } from "@main/utils/broadcast";
import { wsBroadcast } from "@main/server/broadcast";
import * as nowPlaying from "@main/services/nowPlaying";
import type { NowPlayingUpdatePayload } from "@shared/types/nowPlaying";

/** 注册播放快照、歌词偏移及设备延迟的进程通信 */
export const registerNowPlayingIpc = (): void => {
  // 渲染进程同步当前播放状态到主进程
  ipcMain.on("nowPlaying:update", (_event, payload: NowPlayingUpdatePayload) => {
    nowPlaying.update(payload.track, payload.lyric, payload.source);
  });

  // 渲染进程写入指定曲目的歌词偏移
  ipcMain.on("nowPlaying:setLyricOffset", (_event, trackId: string, offsetMs: number) => {
    nowPlaying.setLyricOffset(trackId, offsetMs);
  });

  ipcMain.on("nowPlaying:setDeviceLatency", (event, latencyMs: number) => {
    if (event.sender === getMainWindow()?.webContents) nowPlaying.setDeviceLatency(latencyMs);
  });
  nowPlaying.onDeviceLatencyChange((value) => broadcast("nowPlaying:device-latency-change", value));

  // 窗口拉取当前完整快照
  ipcMain.handle("nowPlaying:requestSnapshot", () => nowPlaying.snapshot());

  // 订阅 service 事件：同时广播给渲染端窗口和外部 WS 客户端
  // position-sync 高频（5Hz），WS 端走 HIGH_FREQ_EVENTS 过滤自动跳过
  nowPlaying.onTrackChange((data) => {
    broadcast("nowPlaying:track-change", data);
    wsBroadcast({ type: "track", data });
  });
  nowPlaying.onLyricChange((snap) => {
    broadcast("nowPlaying:lyric-change", snap);
    wsBroadcast({ type: "lyric", data: { source: snap.source, lyric: snap.lyric } });
  });
  nowPlaying.onPositionSync((data) => broadcast("nowPlaying:position-sync", data, true));
  nowPlaying.onLyricOffsetChange((data) => {
    broadcast("nowPlaying:lyric-offset-change", data);
    wsBroadcast({ type: "lyricOffset", data });
  });
};
