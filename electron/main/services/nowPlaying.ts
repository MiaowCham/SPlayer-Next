import { EventEmitter } from "node:events";
import type { Track, PlayerState, LoadResult } from "@shared/types/player";
import { lyricVersionOffsetKey, normalizeLyricOffset } from "@shared/utils/lyricVersion";
import type { LyricMatchCandidate } from "@shared/types/lyrics";
import type { LyricLine } from "@shared/types/lyrics";
import type { LyricData } from "@shared/types/lyrics";

import type {
  NowPlayingSnapshot,
  NowPlayingPositionSync,
  NowPlayingLyricOffsetSync,
} from "@shared/types/nowPlaying";
import { store } from "@main/store";
import { normalizeDeviceLatency } from "@shared/utils/presentationTime";

type NowPlayingEvents = {
  "device-latency-change": [number];
  /** 歌曲切换 */
  "track-change": [{ track: Track | null }];
  /** 歌词内容变化 */
  "lyric-change": [NowPlayingSnapshot];
  /** 播放位置锚点 */
  "position-sync": [NowPlayingPositionSync];
  /** 当前曲目歌词偏移变化 */
  "lyric-offset-change": [NowPlayingLyricOffsetSync];
};

/** 当前歌曲轻量信息 */
let currentTrack: Track | null = null;
/** 当前歌曲的完整解析歌词 */
let currentLyric: LyricLine[] = [];
/** 当前激活的歌词源 */
let currentSource: LyricData = null;
/** 最近一次播放位置（毫秒） */
let lastPosition = 0;
/** lastPosition 真实成立的墙钟时刻（Date.now 毫秒），用于补偿其过期时长 */
let lastPositionAt = 0;
let pendingTransition: { trackId: string; anchor: NonNullable<LoadResult["playback"]> } | null =
  null;

/**
 * 保留新曲的真实锚点，等界面提交对应歌词时一起切换
 * @param trackId - 新曲标识
 * @param anchor - 引擎交接时的位置与状态
 */
export const prepareTransition = (
  trackId: string,
  anchor: NonNullable<LoadResult["playback"]>,
): void => {
  pendingTransition = { trackId, anchor };
};
/** 当前是否处于播放态 */
let playing = false;
/** 完整播放状态，区分 stopped 与 paused */
let playState: PlayerState = "idle";
/** 当前播放速度倍率（0.5 ~ 2.0） */
let playSpeed = 1.0;
/** 当前曲目对应的歌词偏移（ms，正值为歌词提前） */
let currentLyricOffsetMs = 0;
let deviceLatencyMs = 0;

/** 内部事件总线 */
const emitter = new EventEmitter<NowPlayingEvents>();

/**
 * 获取旧版来源偏移键，供首次校准前继承已有配置
 * @param trackId - 曲目 ID
 * @param source - 歌词源，null（歌词未加载）时退化为裸 trackId
 */
const offsetKey = (trackId: string, source: LyricData): string => {
  if (!source) return trackId;
  const src =
    source.source === "online" && source.platform ? `online:${source.platform}` : source.source;
  return `${trackId}|${src}`;
};

/**
 * 从存储中读取指定曲目当前歌词源的偏移
 * @param track - 曲目
 * @param source - 歌词源
 * @returns 偏移值（毫秒），缺省视为 0
 */
const readOffset = (track: Track | null, source: LyricData): number => {
  if (!track) return 0;
  const map = store.get("player.lyricOffsets") ?? {};
  return (
    (source?.versionId ? map[lyricVersionOffsetKey(track, source.versionId)] : undefined) ??
    map[offsetKey(track.id, source)] ??
    0
  );
};

/** 当前生效偏移对应的存储 key，用于检测曲目/歌词源变化 */
let currentOffsetKey = "";

/**
 * 同步当前播放状态
 * @param track - 当前曲目
 * @param lyric - 当前歌词
 * @param source - 当前歌词源
 */
export const update = (track: Track | null, lyric: LyricLine[], source: LyricData): void => {
  const trackChanged = (currentTrack?.id ?? null) !== (track?.id ?? null);
  currentTrack = track;
  currentLyric = lyric;
  currentSource = source;
  if (pendingTransition && pendingTransition.trackId === track?.id) {
    const { anchor } = pendingTransition;
    lastPosition = anchor.position;
    lastPositionAt = anchor.timestamp;
    playing = anchor.state === "playing";
    playState = anchor.state;
    playSpeed = anchor.speed;
    pendingTransition = null;
  } else if (trackChanged) {
    // 重置播放进度
    lastPosition = 0;
    lastPositionAt = Date.now();
    pendingTransition = null;
  }
  if (trackChanged) {
    emitter.emit("track-change", { track });
  }
  // 曲目或歌词源任一变化都重读偏移并广播
  const key = track
    ? source?.versionId
      ? lyricVersionOffsetKey(track, source.versionId)
      : offsetKey(track.id, source)
    : "";
  if (trackChanged || key !== currentOffsetKey) {
    currentOffsetKey = key;
    currentLyricOffsetMs = readOffset(track, source);
    emitter.emit("lyric-offset-change", {
      trackId: track?.id ?? null,
      offsetMs: currentLyricOffsetMs,
    });
  }
  emitter.emit("lyric-change", snapshot());
};

/**
 * 同步播放位置
 * @param positionMs - 播放位置（毫秒）
 * @param isPlaying - 是否处于播放态
 */
export const onPosition = (positionMs: number, isPlaying: boolean): void => {
  lastPosition = positionMs;
  lastPositionAt = Date.now();
  playing = isPlaying;
  if (isPlaying) playState = "playing";
  emitter.emit("position-sync", {
    position: positionMs,
    playing: isPlaying,
    state: playState,
    speed: playSpeed,
    sendTimestamp: lastPositionAt,
  });
};

/**
 * 同步播放状态
 * @param state - 引擎播放状态（idle/loading/playing/paused/stopped）
 */
export const onPlayStateChange = (state: PlayerState): void => {
  playState = state;
  playing = state === "playing";
  emitter.emit("position-sync", {
    position: lastPosition,
    playing,
    state,
    speed: playSpeed,
    // 暂停态接收端不补偿延迟，恢复态不能用陈旧时间戳，故取当前时刻
    sendTimestamp: Date.now(),
  });
};

/**
 * 同步播放速度
 * @param speed - 播放速度倍率（0.5 ~ 2.0）
 *
 * 立即广播一帧 position-sync，让窗口当帧换挡，无需等待下一个 5Hz 周期
 */
export const onSpeedChange = (speed: number): void => {
  playSpeed = Number.isFinite(speed) ? speed : 1.0;
  emitter.emit("position-sync", {
    position: lastPosition,
    playing,
    state: playState,
    speed: playSpeed,
    sendTimestamp: lastPositionAt || Date.now(),
  });
};

/**
 * 写入当前版本歌词偏移；旧来源记录仍按零值清除
 * 偏移跟随当前歌词源，持久化到 store 并在影响当前曲目时广播
 * @param trackId - 目标 Track.id
 * @param offsetMs - 偏移值（毫秒），自动 clamp 到 ±60s
 */
export const setLyricOffset = (trackId: string, offsetMs: number): void => {
  if (!trackId) return;
  // IPC 进来可能是 NaN/Infinity，会污染所有下游时间叠加计算，统一视为清除
  const value = normalizeLyricOffset(offsetMs);
  const versionKey =
    currentTrack?.id === trackId && currentSource?.versionId
      ? lyricVersionOffsetKey(currentTrack, currentSource.versionId)
      : null;
  const key = versionKey ?? offsetKey(trackId, currentSource);
  const map = { ...(store.get("player.lyricOffsets") ?? {}) };
  if (value === 0 && !versionKey) delete map[key];
  else map[key] = value;
  store.set("player.lyricOffsets", map);
  // 影响当前曲目则更新运行时缓存并广播
  if (currentTrack && currentTrack.id === trackId) {
    currentLyricOffsetMs = value;
    emitter.emit("lyric-offset-change", { trackId, offsetMs: value });
  }
};

/**
 * 读取指定版本的偏移，首次校准前继承该来源的旧偏移
 * @param track - 目标曲目
 * @param candidate - 歌词版本
 * @returns 偏移毫秒数
 */
export const getVersionOffset = (track: Track, candidate: LyricMatchCandidate): number => {
  const source: NonNullable<LyricData> = {
    source: candidate.local ? "managed" : candidate.origin === "localTtml" ? "external" : "online",
    format: candidate.format,
    platform: candidate.platform,
    versionId: candidate.id,
  };
  return readOffset(track, source);
};

/**
 * 保存版本偏移并立即同步正在使用此版本的所有歌词窗口
 * @param track - 目标曲目
 * @param candidate - 歌词版本
 * @param offsetMs - 偏移毫秒数，正值使歌词提前
 * @returns 规范化后的偏移
 */
export const setVersionOffset = (
  track: Track,
  candidate: LyricMatchCandidate,
  offsetMs: number,
): number => {
  const key = lyricVersionOffsetKey(track, candidate.id);
  const value = normalizeLyricOffset(offsetMs);
  store.set("player.lyricOffsets", { ...(store.get("player.lyricOffsets") ?? {}), [key]: value });
  if (key === currentOffsetKey) {
    currentLyricOffsetMs = value;
    emitter.emit("lyric-offset-change", { trackId: track.id, offsetMs: value });
  }
  return value;
};

/** 拉取当前完整状态 */
export const snapshot = (): NowPlayingSnapshot => ({
  track: currentTrack,
  lyric: currentLyric,
  source: currentSource,
  position: lastPosition,
  playing,
  state: playState,
  speed: playSpeed,
  lyricOffsetMs: currentLyricOffsetMs,
  deviceLatencyMs,
  // 用 position 的成立时刻，接收端据此补偿其过期时长
  sendTimestamp: lastPositionAt || Date.now(),
});

/** 获取不含完整歌词正文的轻量播放快照 */
export const lightSnapshot = () => ({
  track: currentTrack,
  position: lastPosition,
  playing,
  state: playState,
  speed: playSpeed,
  lyricOffsetMs: currentLyricOffsetMs,
  deviceLatencyMs,
  lyricAvailable: currentLyric.length > 0,
  lyricLineCount: currentLyric.length,
  sendTimestamp: lastPositionAt || Date.now(),
});

/** 获取当前曲目的完整歌词快照 */
export const lyricSnapshot = () => ({
  trackId: currentTrack?.id ?? null,
  lyric: currentLyric,
  source: currentSource,
  lyricOffsetMs: currentLyricOffsetMs,
  deviceLatencyMs,
});

/** 清空 */
export const clear = (): void => {
  pendingTransition = null;
  currentTrack = null;
  currentLyric = [];
  currentSource = null;
  currentLyricOffsetMs = 0;
  currentOffsetKey = "";
  emitter.emit("lyric-change", snapshot());
  emitter.emit("lyric-offset-change", { trackId: null, offsetMs: 0 });
};

/** 订阅歌曲切换 */
export const onTrackChange = (listener: (data: { track: Track | null }) => void): (() => void) => {
  emitter.on("track-change", listener);
  return () => emitter.off("track-change", listener);
};

/** 订阅歌词内容变化 */
export const onLyricChange = (listener: (snap: NowPlayingSnapshot) => void): (() => void) => {
  emitter.on("lyric-change", listener);
  return () => emitter.off("lyric-change", listener);
};

/** 订阅播放位置锚点 */
export const onPositionSync = (listener: (data: NowPlayingPositionSync) => void): (() => void) => {
  emitter.on("position-sync", listener);
  return () => emitter.off("position-sync", listener);
};

/** 订阅当前曲目歌词偏移变化 */
export const onLyricOffsetChange = (
  listener: (data: NowPlayingLyricOffsetSync) => void,
): (() => void) => {
  emitter.on("lyric-offset-change", listener);
  return () => emitter.off("lyric-offset-change", listener);
};

/**
 * 更新输出设备延迟，单曲歌词偏移保持独立
 * @param latencyMs - 设备延迟毫秒数
 */
export const setDeviceLatency = (latencyMs: number): void => {
  const next = normalizeDeviceLatency(latencyMs);
  if (next === deviceLatencyMs) return;
  deviceLatencyMs = next;
  emitter.emit("device-latency-change", next);
};

/**
 * 订阅当前设备延迟变化
 * @param listener - 延迟更新回调
 * @returns 取消订阅函数
 */
export const onDeviceLatencyChange = (listener: (latencyMs: number) => void): (() => void) => {
  emitter.on("device-latency-change", listener);
  return () => {
    emitter.off("device-latency-change", listener);
  };
};
