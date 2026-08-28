/** CJK 部首补充、康熙部首、CJK 兼容表意文字——均与标准汉字同形/近形异码 */
const COMPAT_RE = /[\u2E80-\u2EFF\u2F00-\u2FDF\uF900-\uFAFF]/g;

/** CJK 统一表意文字（含扩展 A）——用于判断文本是否含汉字，避免对纯假名/拉丁文本做无谓扫描 */
const HAS_HAN_RE = /[\u3400-\u4DBF\u4E00-\u9FFF]/;

/**
 * 将康熙部首、兼容表意文字等同形异码字符还原为标准汉字
 *
 * NCM 歌词常混入康熙部首（⾔ 实为 言）或 CJK 兼容表意文字，导致字体回退与逐字匹配失配。
 * 仅对这些区间做 NFKC；刻意不动全角字母数字与日文兼容假名——歌词里它们多为有意排版，全量 NFKC 会误伤。
 * 先判断文本含汉字才转换，纯假名/拉丁文本直接原样返回。
 * @param text - 原始歌词文本
 */
export const normalizeKangxi = (text: string): string =>
  HAS_HAN_RE.test(text) ? text.replace(COMPAT_RE, (char) => char.normalize("NFKC")) : text;
