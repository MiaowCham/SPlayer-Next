import type { LyricLine } from "./lyrics";

/** 发音优化方式，离线词典目前支持日语 */
export type PronunciationOptimization = "off" | "llm" | "dictionary";

/** 当前歌词版本的展示增强请求 */
export interface LyricEnhancementRequest {
  versionKey: string;
  locale: string;
  lines: LyricLine[];
  translate: boolean;
  pronunciation: PronunciationOptimization;
}

/** 本地词典状态 */
export interface LyricDictionaryStatus {
  installed: boolean;
  downloading: boolean;
  version: string;
}

/** 增强结果保留原歌词时序，只更新翻译和发音 */
export interface LyricEnhancementResult {
  lines: LyricLine[];
  warnings: string[];
}

/** 歌词增强 IPC，仅主进程接触密钥、词典和磁盘缓存 */
export interface LyricEnhancementApi {
  enhance: (request: LyricEnhancementRequest) => Promise<LyricEnhancementResult>;
  dictionaryStatus: () => Promise<LyricDictionaryStatus>;
  downloadDictionary: () => Promise<LyricDictionaryStatus>;
  removeDictionary: () => Promise<LyricDictionaryStatus>;
  clearCache: () => Promise<void>;
}
