import type { LyricFormat } from "@shared/types/lyrics";

export type LyricAuthorKind = "creator" | "lyric-production" | "song-production";

export interface LyricAuthorInfo {
  authors: string[];
  kind: LyricAuthorKind | null;
}

/**
 * 从歌词原始内容中提取歌曲创作者，缺失时回退歌词文件作者
 * @param content - 歌词原始文本
 * @param format - 歌词格式
 * @returns 作者账号/名称的数组
 */
export const extractLyricAuthorInfo = (content: string, format: LyricFormat): LyricAuthorInfo => {
  if (format === "ttml" || format === "ttmlLine") {
    const document = new DOMParser().parseFromString(content, "application/xml");
    const elements = Array.from(document.querySelectorAll("*"));
    const songwriters = elements
      .filter((element) => element.localName === "songwriter")
      .flatMap((element) => splitAuthors(element.textContent ?? ""));
    if (songwriters.length > 0) return { authors: unique(songwriters), kind: "creator" };
    const meta = elements.filter((element) => element.localName === "meta");
    const logins = meta
      .filter((element) => element.getAttribute("key") === "ttmlAuthorGithubLogin")
      .map((element) => element.getAttribute("value")?.trim() ?? "")
      .filter(Boolean);
    if (logins.length > 0) {
      return { authors: unique(logins), kind: "lyric-production" };
    }
    // 如果无 login 标识，从 ttmlAuthorGithub 主页链接中截取最后的用户名
    const bases = meta
      .filter((element) => element.getAttribute("key") === "ttmlAuthorGithub")
      .map((element) => {
        const val = element.getAttribute("value")?.trim() ?? "";
        const parts = val.split("/");
        return parts[parts.length - 1] || val;
      })
      .filter(Boolean);
    return { authors: unique(bases), kind: bases.length > 0 ? "lyric-production" : null };
  }
  if (format === "lrc" || format === "lrcn") {
    const songwriters = [...content.matchAll(/^\[songwriter:\s*([^\]]+)\]/gim)].flatMap((m) =>
      splitAuthors(m[1]),
    );
    if (songwriters.length > 0) return { authors: unique(songwriters), kind: "creator" };
    const authors = [...content.matchAll(/^\[by:\s*([^\]]+)\]/gim)].flatMap((m) =>
      splitAuthors(m[1]),
    );
    const result = unique(authors);
    return { authors: result, kind: result.length > 0 ? "lyric-production" : null };
  }
  return { authors: [], kind: null };
};

/**
 * 从歌词原始内容中提取作者名称，保留旧接口供其他调用方使用。
 * @param content - 歌词原始文本
 * @param format - 歌词格式
 * @returns 作者名称数组
 */
export const extractLyricAuthors = (content: string, format: LyricFormat): string[] =>
  extractLyricAuthorInfo(content, format).authors;

const splitAuthors = (value: string): string[] =>
  value
    .split(/[;,、，]/)
    .map((item) => item.trim())
    .filter(Boolean);

const unique = (authors: string[]): string[] => Array.from(new Set(authors));

const INVALID_CREATOR_NAMES = new Set([
  "无",
  "暂无",
  "未知",
  "不详",
  "none",
  "null",
  "unknown",
  "n/a",
  "na",
]);

/** 判断 API 作者名称是否为无效占位内容。 */
const isValidCreatorName = (name: string): boolean =>
  !!name && !INVALID_CREATOR_NAMES.has(name.toLowerCase());

/**
 * 从网易云 UGC 歌曲信息提取创作者，按角色顺序去重
 * @param body - UGC 歌曲信息响应
 * @returns 创作者名称列表
 */
export const extractNeteaseCreators = (body: unknown): string[] => {
  const data = (body as { data?: Record<string, unknown> } | null)?.data;
  if (!data) return [];
  const result: string[] = [];
  for (const key of [
    "artistRepVos",
    "lyricArtists",
    "composeArtists",
    "arrangeArtists",
    "roleArtists",
  ]) {
    const list = data[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const name = (item as { artistName?: unknown } | null)?.artistName;
      if (typeof name !== "string") continue;
      const normalized = name.trim();
      if (isValidCreatorName(normalized)) result.push(normalized);
    }
  }
  return unique(result);
};
