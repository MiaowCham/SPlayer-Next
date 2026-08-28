import type { LyricFormat } from "@shared/types/lyrics";
import { DEFAULT_LYRIC_FORMAT_ORDER as DEFAULT_LYRIC_FORMAT_ORDER_SHARED } from "@shared/types/lyrics";
import type { Platform } from "@shared/types/platform";
import type { QualityLevel } from "@/utils/quality";

/** 播放器背景类型 */
export type PlayerBgType = "blur" | "solid" | "animation";
export type CoverLayout = "default" | "fullscreen";

/**
 * 歌曲播放时间显示格式
 * - current-total: 播放时间 / 总时长
 * - remaining-total: 剩余时间 / 总时长
 * - current-remaining: 播放时间 / 剩余时间
 */
export type TimeFormat = "current-total" | "remaining-total" | "current-remaining";

/**
 * 歌词来源偏好
 * - auto：智能选择（按打分结果）
 * - Platform（netease / qqmusic / kugou…）：优先该平台
 * - local：仅使用本地（含手动管理）歌词
 * - self：跟随歌曲自身来源平台
 */
export type LyricSourcePreference = Platform | "auto" | "local" | "self";

/** 布局模式 */
export type LayoutMode = "default" | "sidebar-full" | "floating";

/** 路由切换动效 */
export type RouteTransition = "none" | "fade" | "slide" | "zoom";

/** 弹簧动画预设 */
export type SpringPreset =
  "default" | "smooth" | "responsive" | "jello" | "heavy" | "noBounce" | "custom";

/** 歌词混合模式 */
export type LyricBlendMode = "normal" | "screen" | "plus-lighter";

/** 歌词与发音同时显示时的大字体内容 */
export type LargerLyricText = "lyrics" | "pronunciation";

/** 中文歌词的字形偏好 */
export type ChineseScriptPreference = "default" | "simplified" | "traditional";

/** 逐字上浮动画强度 */
export type LyricFloatAnimationIntensity = "low" | "medium" | "high" | "very-high" | "extreme";

/** 弹簧预设参数映射 */
export const SPRING_PRESETS: Record<
  Exclude<SpringPreset, "custom">,
  { mass: number; damping: number; stiffness: number }
> = {
  default: { mass: 0.9, damping: 15, stiffness: 90 },
  smooth: { mass: 1.2, damping: 22, stiffness: 80 },
  responsive: { mass: 0.5, damping: 18, stiffness: 150 },
  jello: { mass: 0.6, damping: 8, stiffness: 120 },
  heavy: { mass: 2.0, damping: 25, stiffness: 60 },
  noBounce: { mass: 1.0, damping: 30, stiffness: 100 },
};

/** 可排序的歌词来源（本地文件始终固定在首位） */
export type LyricSourceOrderItem = Platform | "amll" | "localTtml" | "appleMusic";

/** 歌词来源排序：来源偏好为「智能选择」时，按此顺序尝试可用来源 */
export type LyricSourceOrder = LyricSourceOrderItem[];

/** 歌词格式优先级：决定多种格式可用时的选择，以及 TTML 是否覆盖平台主格式 */
export type LyricFormatOrder = LyricFormat[];

/** 默认音源顺序 */
export const DEFAULT_LYRIC_SOURCE_ORDER: LyricSourceOrder = [
  "appleMusic",
  "localTtml",
  "amll",
  "qqmusic",
  "netease",
  "kugou",
];

/** 默认格式优先级 */
export const DEFAULT_LYRIC_FORMAT_ORDER: LyricFormatOrder = [...DEFAULT_LYRIC_FORMAT_ORDER_SHARED];

/** 歌词设置 */
export interface LyricSettings {
  /** 歌词来源偏好 */
  lyricSourcePreference: LyricSourcePreference;
  /** 音源顺序 */
  lyricSourceOrder: LyricSourceOrder;
  /** 歌词格式优先级 */
  lyricFormatOrder: LyricFormatOrder;
  /** 智能选择是否优先在线 */
  smartPreferOnline: boolean;
  /** 自动识别背景歌词 */
  detectBackgroundLyrics: boolean;
  /** 中文歌词繁简字形偏好 */
  chineseScriptPreference: ChineseScriptPreference;
  /** 字号自适应窗口大小 */
  adaptiveFontSize: boolean;
  /** 歌词字号（px，自适应关闭时生效） */
  fontSize: number;
  /** 歌词字重（100~900） */
  fontWeight: number;
  /** 歌词混合模式 */
  lyricBlendMode: LyricBlendMode;
  /** 是否将发音显示在翻译上方 */
  swapTranslationPronunciation: boolean;
  /** 歌词与发音同时显示时的大字体内容 */
  largerLyricText: LargerLyricText;
  /** 逐字歌词仅有逐行发音时，是否强制将发音作为逐句主歌词 */
  forceLinePronunciationAsMain: boolean;
  /** 歌词字体 */
  fontFamily: string;
  /** 拉丁文字歌词字体（为空时跟随歌词字体） */
  fontFamilyLatin: string;
  /** 日文歌词字体（为空时跟随歌词字体） */
  fontFamilyJapanese: string;
  /** 韩文歌词字体（为空时跟随歌词字体） */
  fontFamilyKorean: string;
  /** 中文歌词字体（为空时跟随歌词字体） */
  fontFamilyChinese: string;
  /** 是否显示翻译歌词 */
  showTranslation: boolean;
  /** 未命中应用语言时是否回退其他语言翻译 */
  fallbackTranslation: boolean;
  /** 是否显示音译歌词 */
  showRomanization: boolean;
  /** AMLL 是否显示逐行音译 */
  amllShowLineRomanization: boolean;
  /** AMLL 是否显示逐词音译 */
  amllShowWordRomanization: boolean;
  /** AMLL 是否独立计算逐词发音遮罩进度 */
  independentWordRomanizationProgress: boolean;
  /** 是否将康熙部首/CJK 兼容表意文字等非标准汉字还原为标准汉字 */
  normalizeNonStandardHan: boolean;
  /** 逐字高亮效果 */
  enableWordHighlight: boolean;
  /** 逐字上浮动画强度 */
  floatAnimationIntensity: LyricFloatAnimationIntensity;
  /** 强调效果（缩放 + 辉光 + 正弦浮动） */
  enableEmphasizeEffect: boolean;
  /** 禁用 CJK 歌词的强调效果 */
  disableCjkEmphasis: boolean;
  /** 多行同时高亮时是否临时抬高歌词对齐位置 */
  raiseAlignPositionOnOverlap: boolean;
  /** 逐行模糊效果 */
  enableBlur: boolean;
  /** 暂停时解除逐行模糊（需启用 enableBlur） */
  pauseClearBlur: boolean;
  /** 隐藏已播放行 */
  hidePassedLines: boolean;
  /** 弹簧动画预设 */
  springPreset: SpringPreset;
  /** 弹簧质量 */
  springMass: number;
  /** 弹簧阻尼 */
  springDamping: number;
  /** 弹簧刚度 */
  springStiffness: number;
  /** 激活行对齐位置（0~1） */
  alignPosition: number;
  /** 逐字掩码渐变宽度 */
  wordFadeWidth: number;
  /** 非激活行透明度 */
  inactiveAlpha: number;
  /** 启用歌词排除 */
  enableExcludeLyrics: boolean;
  /** 用户自定义关键词 */
  excludeLyricsUserKeywords: string[];
  /** 用户自定义正则 */
  excludeLyricsUserRegexes: string[];
  /** 歌词引擎类型 */
  engine: "physics" | "amll";
  /** AM 歌词是否启用物理回弹与缩放 */
  useAMSpring: boolean;
  /** AMLL 垂直位移弹簧参数 */
  amllVerticalSpringMass: number;
  amllVerticalSpringDamping: number;
  amllVerticalSpringStiffness: number;
  amllVerticalSpringSoft: boolean;
  /** AMLL 缩放弹簧参数 */
  amllScaleSpringMass: number;
  amllScaleSpringDamping: number;
  amllScaleSpringStiffness: number;
  amllScaleSpringSoft: boolean;
}

/** 播放器设置 */
export interface PlayerSettings {
  /** 播放器背景类型 */
  playerBgType: PlayerBgType;
  /** 流体背景帧率（fps） */
  playerBgFps: number;
  /** 流体背景流动速度 */
  playerBgFlowSpeed: number;
  /** 流体背景渲染缩放 */
  playerBgRenderScale: number;
  /** 暂停播放时冻结流体背景 */
  playerBgFreezeOnPause: boolean;
  /** 流体背景随低频节拍脉动 */
  playerBgBeat: boolean;
  /** 全屏播放器封面布局 */
  coverLayout: CoverLayout;
  /** 无歌词时自动居中封面并隐藏歌词区域 */
  autoCenterCover: boolean;
  /** 全屏播放器显示当前播放来源 */
  showPlaybackSource: boolean;
  /** 颜色是否跟随封面 */
  followCoverColor: boolean;
  /** 全屏播放器自动进入沉浸模式（隐藏顶/底栏与鼠标） */
  autoImmersive: boolean;
  /** 输出设备名称，null 表示跟随系统默认 */
  outputDevice: string | null;
  /** 切换输出设备时暂停播放 */
  pauseOnDeviceSwitch: boolean;
  /** 是否启用音乐频谱可视化 */
  enableSpectrum: boolean;
  /** 频谱单条宽度（px） */
  spectrumBarWidth: number;
  /** 是否反转频谱方向（启用后低频位于频谱两端） */
  reverseSpectrum: boolean;
  /** 在线歌曲音质偏好；实际可用级别取决于账号权限 */
  songLevel: QualityLevel;
  /** 允许完整音源不可用时播放试听片段 */
  allowTrialPlay: boolean;
  /** 时间显示格式 */
  timeFormat: TimeFormat;
  /** 显示进度条悬浮信息 */
  showProgressTooltip: boolean;
  /** 进度条悬浮时显示歌词 */
  showProgressLyric: boolean;
  /** 进度调节吸附最近歌词 */
  snapToLyric: boolean;
  /** 拖拽播放页进度条时让歌词跟随预览位置滚动 */
  followLyricOnProgressDrag: boolean;
  /** 播放时底部显示歌词而非歌手名 */
  showLyricInBar: boolean;
  /** 播放时提前获取下一首的播放数据 */
  preloadNextTrack: boolean;
}

/** 外观设置 */
export interface AppearanceSettings {
  /** 布局模式 */
  layoutMode: LayoutMode;
  /** 路由切换动效 */
  routeTransition: RouteTransition;
  /** 侧边栏折叠 */
  sidebarCollapsed: boolean;
  /** 侧边栏 Logo 快捷切换折叠状态 */
  sidebarShortcutToggle: boolean;
  /** 侧边栏歌单项显示封面 */
  sidebarPlaylistCover: boolean;
  /** 侧边栏显示播放统计入口 */
  showStatsInSidebar: boolean;
  /** 播放栏显示快捷音质切换 */
  showQualitySwitch: boolean;
  /** 点击关闭按钮的行为 */
  closeAction: "quit" | "hide";
  /** 记忆关闭选择 */
  rememberCloseChoice: boolean;
  /** 全局字体 */
  fontFamily: string;
  /** 性能监视器悬浮卡片 */
  showPerformanceMonitor: boolean;
}

/** 强迫症设置 */
export interface PresetSettings {
  /** Fuck DJ Mode */
  fuckDjMode: boolean;
  /** Fuck ** Mode */
  uncensorProfanity: boolean;
  /** 隐藏歌曲列表的 VIP 标签 */
  hideVipTag: boolean;
  /** 隐藏歌曲列表的音质标签 */
  hideQualityTag: boolean;
  /** 显示歌曲副标题（别名） */
  showSubtitle: boolean;
}
