import type { AudioPlayer } from "@splayer/audio-engine";
import type { Track } from "@shared/types/player";
import type { LyricPreviewState } from "@shared/types/lyricPreview";
import { getEngine, getPlayer } from "./engine";
import { prepareStreamingPlayback } from "./streaming/playback";
import { store } from "@main/store";
import { playerLog } from "@main/utils/logger";

interface PreviewSession {
  id: string;
  player: AudioPlayer;
  start: number;
  duration: number;
  ready: boolean;
  send: (state: LyricPreviewState) => void;
}
let active: PreviewSession | null = null;
let mainResume: {
  sessionId: string;
  player: AudioPlayer;
  position: number;
} | null = null;

/**
 * 试听播放时拦截迟到的主播放，并取得恢复权
 * @param main - 触发播放事件的主实例
 * @returns 是否拦截了主播放
 */
export const pauseMainForPreview = (main: AudioPlayer): boolean => {
  const session = active;
  if (!session?.ready || session.player.getStatus().state !== "playing") return false;
  if (main.getStatus().state !== "playing") return true;
  main.pauseImmediately();
  mainResume = { sessionId: session.id, player: main, position: main.getPosition() };
  return true;
};

/** 用户主动控制主播放时暂停试听，并放弃本次自动恢复权 */
export const cancelPreviewMainResume = (): void => {
  mainResume = null;
  if (active?.ready && active.player.getStatus().state === "playing") {
    active.player.pauseImmediately();
    active.send(snapshot(active));
  }
};

/**
 * 恢复本次试听暂停且仍停在原位置的主播放器
 * @param sessionId - 可选的恢复权拥有者，过期播放失败不能释放新会话的恢复权
 */
const restoreMain = (sessionId?: string): void => {
  if (sessionId && mainResume?.sessionId !== sessionId) return;
  const resume = mainResume;
  mainResume = null;
  if (!resume || resume.player !== getPlayer()) return;
  const status = resume.player.getStatus();
  if (
    status.state !== "paused" ||
    status.isFinished ||
    Math.abs(status.position - resume.position) > 0.25
  )
    return;
  void resume.player.play().catch((error) => playerLog.warn("试听结束后恢复播放失败:", error));
};

/**
 * 读取独立试听状态，不读取或推进主播放进度
 * @param session - 当前试听会话
 * @returns 毫秒播放快照
 */
const snapshot = (session: PreviewSession): LyricPreviewState => {
  const status = session.player.getStatus();
  return {
    sessionId: session.id,
    position: Math.max(0, Math.min(session.duration, status.position * 1000 - session.start)),
    duration: session.duration,
    playing: status.state === "playing",
    ready: session.ready,
  };
};

/**
 * 停止试听并释放原生回调，过期关闭不会影响新会话
 * @param sessionId - 待关闭的会话身份
 * @param restore - 是否恢复主播放，退出应用时关闭
 */
export const closeLyricPreview = (sessionId?: string, restore = true): void => {
  if (sessionId && active?.id !== sessionId) return;
  const session = active;
  active = null;
  if (session) {
    session.player.onEvent(() => {});
    try {
      session.player.stop();
    } catch (error) {
      playerLog.warn("停止歌词试听失败:", error);
    }
  }
  if (restore) restoreMain();
  else mainResume = null;
};

/**
 * 开始试听前暂停正在播放的主实例，仅记录由本次试听取得的恢复权
 * @param session - 将播放的试听会话
 */
const play = async (session: PreviewSession): Promise<void> => {
  const main = getPlayer();
  if (main.getStatus().state === "playing") {
    main.pauseImmediately();
    mainResume = {
      sessionId: session.id,
      player: main,
      position: main.getPosition(),
    };
  }
  try {
    await session.player.play();
    if (active !== session) session.player.stop();
  } catch (error) {
    restoreMain(session.id);
    throw error;
  }
};

/**
 * 加载一个独立试听实例，不建立主播放或流媒体上报会话
 * @param sessionId - 渲染端本次打开的身份
 * @param track - 试听曲目及 CUE 分轨信息
 * @param source - 已解析的音频路径或流媒体占位符
 * @param send - 仅向可见拥有者发送状态的回调
 * @returns 初始试听快照
 */
export const openLyricPreview = async (
  sessionId: string,
  track: Track,
  source: string,
  send: PreviewSession["send"],
): Promise<LyricPreviewState> => {
  closeLyricPreview();
  const session: PreviewSession = {
    id: sessionId,
    player: new (getEngine().AudioPlayer)(),
    start: track.cueStartMs ?? 0,
    duration: track.duration || 1,
    ready: false,
    send,
  };
  active = session;
  session.player.setFadeDuration(0);
  session.player.setFftEnabled(false);
  session.player.setVolume(store.get("player.volume"));
  session.player.onEvent((event) => {
    if (active !== session || !session.ready) return;
    if (
      event.type === "position" &&
      session.player.getPosition() * 1000 >= session.start + session.duration
    ) {
      session.player.pauseImmediately();
    }
    if (["sourceError", "outputFailed", "outputStalled"].includes(event.type)) {
      session.player.pauseImmediately();
      send({ ...snapshot(session), playing: false, error: "previewFailed" });
      return;
    }
    if (["position", "stateChanged", "ended"].includes(event.type)) send(snapshot(session));
  });
  try {
    const prepared = await prepareStreamingPlayback(track, source);
    if (active !== session) return { ...snapshot(session), ready: false };
    await session.player.setOutputDevice(store.get("player.outputDevice"));
    if (active !== session) return { ...snapshot(session), ready: false };
    const metadata = await session.player.load(prepared?.url ?? source, false);
    if (active !== session) return { ...snapshot(session), ready: false };
    session.duration = Math.max(1, (track.cueEndMs ?? metadata.duration * 1000) - session.start);
    if (session.start) await session.player.seek(session.start / 1000);
    if (active !== session) return { ...snapshot(session), ready: false };
    session.ready = true;
    await play(session);
    return snapshot(session);
  } catch (error) {
    if (active === session) closeLyricPreview(session.id);
    playerLog.warn("歌词独立试听加载失败:", error);
    return {
      sessionId,
      position: 0,
      duration: track.duration || 1,
      ready: false,
      playing: false,
      error: "previewFailed",
    };
  }
};

/**
 * 操作当前试听会话，忽略来自已关闭面板的请求
 * @param sessionId - 试听会话身份
 * @param action - 播放、暂停或定位
 * @param value - 定位毫秒数
 * @returns 当前快照，过期请求返回空值
 */
export const controlLyricPreview = async (
  sessionId: string,
  action: "play" | "pause" | "seek",
  value?: number,
): Promise<LyricPreviewState | null> => {
  const session = active;
  if (!session || session.id !== sessionId || !session.ready) return null;
  if (action === "pause") session.player.pauseImmediately();
  else if (action === "play") await play(session);
  else if (action === "seek" && Number.isFinite(value)) {
    await session.player.seek(
      (session.start + Math.max(0, Math.min(session.duration, value!))) / 1000,
    );
  }
  return active === session ? snapshot(session) : null;
};
