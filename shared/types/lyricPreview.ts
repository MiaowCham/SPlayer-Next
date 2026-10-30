import type { Track } from "./player";

/** 独立歌词试听的低频播放快照，时间单位为毫秒 */
export interface LyricPreviewState {
  sessionId: string;
  position: number;
  duration: number;
  playing: boolean;
  ready: boolean;
  error?: string;
}

/** 试听控制仅作用于指定会话，不进入主播放队列 */
export interface LyricPreviewApi {
  open: (sessionId: string, track: Track, source: string) => Promise<LyricPreviewState>;
  control: (
    sessionId: string,
    action: "play" | "pause" | "seek",
    value?: number,
  ) => Promise<LyricPreviewState | null>;
  close: (sessionId: string) => Promise<void>;
  onState: (callback: (state: LyricPreviewState) => void) => () => void;
}
