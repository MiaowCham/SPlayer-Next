/** 多语言翻译候选。 */
export interface TranslationCandidate {
  lang: string | null | undefined;
}

/** 规范化语言标签。 */
const normalizeLang = (lang: string | null | undefined): string =>
  (lang ?? "").trim().toLowerCase().replace(/_/g, "-");

/** 取得语言标签的主语言部分。 */
const baseLang = (lang: string): string => lang.split("-")[0];

/**
 * 按应用语言选择翻译候选。
 * 未标记语言的 LRCN 翻译按声明顺序使用首项；允许回退时，依次优先中文、英文和其余候选。
 * @param candidates - 翻译候选，顺序即文件声明顺序
 * @param preferredLang - 应用语言标签
 * @param allowFallback - 未命中应用语言时是否允许回退
 * @returns 选中的候选索引；没有可用候选时返回 -1
 */
export const pickTranslationIndex = (
  candidates: readonly TranslationCandidate[],
  preferredLang: string,
  allowFallback = true,
): number => {
  if (candidates.length === 0) return -1;
  const preferred = normalizeLang(preferredLang);
  if (!preferred) return 0;

  const preferredBase = baseLang(preferred);
  const hasTaggedCandidate = candidates.some((candidate) => !!normalizeLang(candidate.lang));
  if (!hasTaggedCandidate) return 0;

  let baseMatch = -1;
  for (let index = 0; index < candidates.length; index++) {
    const lang = normalizeLang(candidates[index].lang);
    if (!lang) continue;
    if (lang === preferred) return index;
    if (baseMatch === -1 && baseLang(lang) === preferredBase) baseMatch = index;
  }
  if (baseMatch !== -1) return baseMatch;
  if (!allowFallback) return -1;

  for (const fallbackLang of ["zh", "en"]) {
    const index = candidates.findIndex(
      (candidate) => baseLang(normalizeLang(candidate.lang)) === fallbackLang,
    );
    if (index !== -1) return index;
  }
  return candidates.findIndex((candidate) => !!normalizeLang(candidate.lang));
};
