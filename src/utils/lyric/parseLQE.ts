import type { LyricInput } from "@shared/types/lyrics";

/** Lyricify Quick Export 的段落头。 */
const SECTION_RE = /^\[(lyrics|translation|pronunciation):\s*format@([^,\]]+)/gim;

/**
 * 将 LQE 容器拆为已有解析器可消费的 LyS、LRC 主/副歌词。
 * @param text - LQE 文件内容
 * @returns 主歌词与可选翻译、发音
 */
export const parseLQEInput = (text: string): LyricInput => {
  const sections = [...text.matchAll(new RegExp(SECTION_RE.source, SECTION_RE.flags))];
  const contentByKind = new Map<string, { content: string; format: string }>();
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index];
    const end = sections[index + 1]?.index ?? text.length;
    contentByKind.set(section[1].toLowerCase(), {
      format: section[2].trim().toLowerCase(),
      content: text.slice((section.index ?? 0) + section[0].length, end).trim(),
    });
  }
  const lyrics = contentByKind.get("lyrics");
  const translation = contentByKind.get("translation");
  const pronunciation = contentByKind.get("pronunciation");
  return {
    content: lyrics?.content ?? "",
    translation: translation?.content,
    translationFormat: translation?.format === "lrc" ? "lrc" : undefined,
    romaji: pronunciation?.content,
    romajiFormat: pronunciation?.format === "lrc" ? "lrc" : undefined,
  };
};
