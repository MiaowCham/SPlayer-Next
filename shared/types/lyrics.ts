import type { Platform } from "./platform";
import type { Track } from "./player";

/** 歌词格式 */
export type LyricFormat =
  | "ttml"
  | "ttmlLine"
  | "lqe"
  | "lys"
  | "yrc"
  | "qrc"
  | "krc"
  | "lrcn"
  | "lnt"
  | "lrc"
  | "srt"
  | "ass";

/** 默认格式优先级（高到低）；本地外挂选择、TTML 升级判定共用 */
export const DEFAULT_LYRIC_FORMAT_ORDER: readonly LyricFormat[] = [
  "ttml",
  "lrcn",
  "lys",
  "qrc",
  "krc",
  "yrc",
  "ttmlLine",
  "lrc",
  "ass",
  "srt",
];

/** 歌词来源 */
export type LyricSource = "external" | "embedded" | "online" | "managed";

/** 歌词行语言；und-Hani 与 und-Latn 分别表示语言未知的汉字与拉丁文字 */
export type LyricLanguage = "ja" | "ko" | "zh-CN" | "und-Hani" | "und-Latn";

/** 歌词数据 */
export type LyricData = {
  source: LyricSource;
  format: LyricFormat;
  /** 在线歌词所属平台，仅 source=online 时有值 */
  platform?: Platform;
  /** 区分平台原始歌词与 AMLL、本地 TTML 等解析提供方 */
  provider?: "amll" | "localTtml" | "appleMusic";
} | null;

/** 歌词时间片段 */
export interface LyricSpan {
  /** 起始时间（毫秒） */
  startTime: number;
  /** 结束时间（毫秒） */
  endTime: number;
  /** 内容 */
  word: string;
}

/** 歌词单词 */
export interface LyricWord extends LyricSpan {
  /** 音译内容 */
  romanWord?: string;
  /** 是否包含不雅用语 */
  obscene?: boolean;
  /** 注音（如日语假名标注） */
  ruby?: LyricSpan[];
}

/** 一行歌词 */
export interface LyricLine {
  /** 主歌词语言，用于字形选择与 HTML lang */
  language?: LyricLanguage;
  /**
   * 该行的所有单词
   * 如果是 LyRiC 等只能表达一行歌词的格式，这里就只会有一个单词且通常其始末时间和本结构的 `startTime` 和 `endTime` 相同
   */
  words: LyricWord[];
  /** 该行的翻译歌词，将会显示在主歌词行的下方 */
  translatedLyric: string;
  /** 该行的音译歌词，将会显示在翻译歌词行的下方 */
  romanLyric: string;
  /** 句子的起始时间，单位为毫秒 */
  startTime: number;
  /** 句子的结束时间，单位为毫秒 */
  endTime: number;
  /** 是否为背景歌词行 */
  isBG: boolean;
  /** 是否为对唱歌词行 */
  isDuet: boolean;
  /** 是否强制按逐句歌词渲染，不使用逐字高亮 */
  isLineLyric?: boolean;
}

/**
 * 歌词原始内容载荷：主 + 可选翻译 / 音译
 */
export interface LyricInput {
  /** 主歌词原始文本 */
  content: string;
  /** 翻译原始文本 */
  translation?: string;
  translationFormat?: LyricFormat;
  /** 罗马音原始文本 */
  romaji?: string;
  romajiFormat?: LyricFormat;
}

/** 用户手动管理的歌词记录 */
export interface ManagedLyric extends LyricInput {
  format: LyricFormat;
  importedAt: number;
  filename: string | null;
  filePath: string;
  versionId: string;
  origin: ManagedLyricOrigin;
  track?: Track;
}

/** 手动歌词版本的来源。 */
export type ManagedLyricOrigin = "manual" | "localTtml" | "amll" | "appleMusic" | Platform;

/** 单曲自定义搜索条件；为空时沿用歌曲元数据。 */
export interface LyricSearchOverride {
  title: string;
  artist: string;
}

/** 单曲歌词来源首选项；仅保存轻量标识，不持久化歌词正文。 */
export type TrackLyricPreference = (
  | { source: "auto" }
  | { source: "self" }
  | { source: "local"; versionId?: string }
  | { source: "localTtml" }
  | { source: "platform"; platform: Platform }
  | { source: "amll"; platform: "netease" | "qqmusic" }
  | { source: "appleMusic" }
) & { search?: LyricSearchOverride };

/** 单曲管理面板展示的歌词候选。 */
export interface LyricMatchCandidate extends LyricInput {
  id: string;
  origin: ManagedLyricOrigin;
  platform?: Platform;
  format: LyricFormat;
  filename: string;
  active: boolean;
  local: boolean;
  importedAt?: number;
  /** 内置来源查询结果；没有正文时仍用于向用户说明检索状态。 */
  status?: "available" | "disabled" | "tokenMissing" | "noMatch" | "error";
  /** 查询状态的人类可读说明，不包含任何敏感令牌。 */
  statusMessage?: string;
}

/** 单曲导入的歌词载荷 */
export interface ManagedLyricImport extends LyricInput {
  format: LyricFormat;
  filename: string;
}

/** 手动导入歌词的写入结果。 */
export type ManagedLyricImportResult =
  | { status: "imported" | "overwritten" | "attached"; versionId: string; activeChanged: boolean }
  | { status: "conflict"; versionId: string; filename: string };

/** 手动管理歌词文件的存储统计 */
export interface ManagedLyricStats {
  /** 独立歌词目录 */
  path: string;
  /** 文件总大小（字节） */
  size: number;
  /** 已管理歌词数量 */
  count: number;
}

/** 手动歌词目录迁移结果。 */
export type ManagedLyricMigrationResult =
  { ok: true; stats: ManagedLyricStats } | { ok: false; error: string };

/** 批量网易云 TTML 导入结果 */
export interface TtmlImportResult {
  imported: number;
  replaced: number;
  skipped: number;
  failed: number;
}

/** 平台额外字段 */
export interface LyricMatchExtra {
  /** QM 的 mid */
  mid?: string;
}

/** 歌词匹配结果 */
export interface LyricMatchResult extends LyricInput {
  platform: Platform;
  /** 主歌词格式 */
  format: LyricFormat;
  /** 平台额外字段，netease/kugou 暂未使用 */
  extra?: LyricMatchExtra;
}

/** 歌词匹配 IPC 响应 */
export type LyricMatchResponse =
  { ok: true; data: LyricMatchResult | null } | { ok: false; error: string };

/** TTML 抓取 IPC 响应 */
export type LyricTTMLResponse = { ok: true; data: string | null } | { ok: false; error: string };

/** Apple Music TTML 凭据状态，不暴露令牌明文。 */
export interface AppleMusicTTMLStatus {
  hasMediaUserToken: boolean;
  /** 当前令牌持久化方式。 */
  storage: "secure" | "compatibility";
}

/** Apple Music TTML 检索结果，供单曲管理页展示搜索状态。 */
export interface AppleMusicTTMLFetchResult {
  lyric: string | null;
  status: "available" | "disabled" | "tokenMissing" | "noMatch" | "error";
  message?: string;
}

/** 渲染端歌词匹配入口 */
export interface LyricsApi {
  /** 渲染进程歌词加载日志，转发到主进程文件日志 */
  log: (level: "info" | "warn" | "error", message: string) => Promise<void>;
  /** 读取歌曲的手动管理歌词 */
  getManaged: (track: Track) => Promise<ManagedLyric | null>;
  /** 重新扫描歌曲歌词目录并同步数据库 */
  refreshManaged: (track: Track) => Promise<boolean>;
  /** 列出所有手动管理歌词 */
  listManaged: () => Promise<Array<ManagedLyric & { trackSource: string; trackId: string }>>;
  /** 搜索本地曲库曲目，供歌词复制目标选择 */
  searchTracks: (query: string) => Promise<Track[]>;
  /** 搜索在线曲目，供歌词复制目标选择 */
  searchOnlineTracks: (query: string) => Promise<Track[]>;
  /** 将一个手动歌词复制应用到多个曲目 */
  copyManaged: (source: Track, targets: Track[]) => Promise<number>;
  /** 删除歌曲的手动管理歌词 */
  removeManaged: (track: Pick<Track, "source" | "id">) => Promise<void>;
  /** 清空全部手动管理歌词 */
  clearManaged: () => Promise<void>;
  /** 读取手动管理歌词的独立存储统计 */
  getManagedStats: () => Promise<ManagedLyricStats>;
  /** 打开手动管理歌词目录 */
  openManagedDir: () => Promise<string>;
  /** 打开当前歌曲的手动歌词目录 */
  openManagedTrackDir: (track: Track) => Promise<string>;
  /** 选择手动导入歌词的新目录 */
  pickManagedDir: () => Promise<string | null>;
  /** 将手动导入歌词迁移到新目录 */
  moveManagedDir: (directory: string) => Promise<ManagedLyricMigrationResult>;
  /** 订阅手动歌词变更，用于立即刷新当前播放歌曲 */
  onManagedChanged: (callback: (data: { source: string; id: string } | null) => void) => () => void;
  /** 选择歌词文件并返回识别后的导入载荷 */
  pickManagedFile: () => Promise<ManagedLyricImport | null>;
  /** 写入歌曲的手动管理歌词 */
  setManaged: (
    track: Track,
    lyric: ManagedLyricImport,
    overwrite?: boolean,
  ) => Promise<ManagedLyricImportResult>;
  /** 读取单曲歌词来源首选项；null 表示沿用全局设置 */
  getTrackPreference: (track: Track) => Promise<TrackLyricPreference | null>;
  /** 写入单曲歌词来源首选项 */
  setTrackPreference: (track: Track, preference: TrackLyricPreference) => Promise<void>;
  /** 获取单曲的本地版本与在线匹配候选 */
  getTrackCandidates: (track: Track) => Promise<LyricMatchCandidate[]>;
  /** 选择一个歌词候选并设为当前活跃版本 */
  selectTrackCandidate: (track: Track, candidate: LyricMatchCandidate) => Promise<boolean>;
  /** 删除非活跃的本地歌词版本 */
  deleteManagedVersion: (track: Track, versionId: string) => Promise<boolean>;
  /** 选择目录并批量导入带网易云元数据的 TTML */
  importNeteaseTtmlDirectory: () => Promise<TtmlImportResult | null>;
  /** 按 id 直取某平台歌词 */
  matchById: (platform: Platform, id: string) => Promise<LyricMatchResponse>;
  /** 按 Track 元数据在某平台模糊搜索歌词 */
  matchByQuery: (platform: Platform, track: Track) => Promise<LyricMatchResponse>;
  /** 抓取 AMLL TTML DB 的 TTML 歌词，仅 NCM/QM 适用 */
  fetchTTMLOverlay: (
    track: Track,
    platform: "netease" | "qqmusic",
    forceQuery?: boolean,
  ) => Promise<LyricTTMLResponse>;
  /** 搜索并抓取 Apple Music TTML 歌词 */
  fetchAppleMusicTTML: (track: Track) => Promise<LyricTTMLResponse>;
  /** 仅读取 Apple Music TTML 持久化缓存，不触发网络搜索。 */
  getCachedAppleMusicTTML: (track: Track) => Promise<LyricTTMLResponse>;
  /** 获取 Apple Music TTML 凭据状态，不返回令牌明文 */
  getAppleMusicTTMLStatus: () => Promise<AppleMusicTTMLStatus>;
  /** 安全保存或清除 Apple Music Media-User-Token */
  setAppleMusicMediaUserToken: (
    token: string,
    storage?: "secure" | "compatibility",
  ) => Promise<AppleMusicTTMLStatus>;
  /** 迁移已保存令牌至指定存储方式，不向渲染进程暴露令牌。 */
  migrateAppleMusicMediaUserToken: (
    storage: "secure" | "compatibility",
  ) => Promise<AppleMusicTTMLStatus>;
  /** 验证已保存令牌，并实际发起一次 Apple Music 搜索 */
  verifyAppleMusicTTMLToken: () => Promise<AppleMusicTTMLFetchResult>;
  /** 在本地 TTML 歌词库中按元信息匹配，命中返回 TTML 原文 */
  matchLocalTTML: (track: Track, forceQuery?: boolean) => Promise<LyricTTMLResponse>;
  /** 弹出目录选择器，返回所选本地 TTML 歌词库目录 */
  pickLyricRepoDir: () => Promise<string | null>;
}
