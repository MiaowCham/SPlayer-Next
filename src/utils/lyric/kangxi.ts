/** CJK 部首补充、康熙部首、CJK 兼容表意文字——均与标准汉字同形/近形异码 */
const COMPAT_RE = /[\u2E80-\u2EFF\u2F00-\u2FDF\uF900-\uFAFF]/g;

/** CJK 部首补充中 NFKC 无法分解的字符 -> 标准汉字映射（来源 Unicode CJKRadicals 数据） */
const RADICAL_SUPPLEMENT_TO_HAN: Record<string, string> = {
  '\u2EA6': '丬',
  '\u2EB0': '纟',
  '\u2EC5': '见',
  '\u2EC8': '讠',
  '\u2EC9': '贝',
  '\u2ECB': '车',
  '\u2ED0': '钅',
  '\u2ED3': '长',
  '\u2ED4': '门',
  '\u2ED9': '韦',
  '\u2EDA': '页',
  '\u2EDB': '风',
  '\u2EDC': '飞',
  '\u2EE0': '饣',
  '\u2EE2': '马',
  '\u2EE5': '鱼',
  '\u2EE6': '鸟',
  '\u2EE7': '卤',
  '\u2EE8': '麦',
  '\u2EE9': '黄',
  '\u2EEA': '黾',
  '\u2EEB': '斉',
  '\u2EEC': '齐',
  '\u2EED': '歯',
  '\u2EEE': '齿',
  '\u2EEF': '竜',
  '\u2EF0': '龙',
  '\u2EF2': '亀',
};

/** CJK 统一表意文字（含扩展 A）或非标准汉字（部首补充/康熙/兼容表意）——文本含其中任一即视为中文内容而转换 */
const HAS_HAN_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\u2E80-\u2EFF\u2F00-\u2FDF\uF900-\uFAFF]/;

/**
 * 将康熙部首、CJK 部首补充、兼容表意文字等同形异码字符还原为标准汉字
 *
 * NCM/AM 歌词常混入康熙部首（⾔ 实为 言）或 CJK 部首补充的简化部首（⻅ 实为 见、⻜ 实为 飞），
 * 导致字体回退与逐字匹配失配。
 * 康熙部首与部分 CJK 部首补充可经 NFKC 还原；CJK 部首补充的 C-SIMPLIFIED（简体）系列 NFKC 不分解，
 * 需查 RADICAL_SUPPLEMENT_TO_HAN 映射。
 * 仅对这些区间做转换；刻意不动全角字母数字与日文兼容假名——歌词里它们多为有意排版，全量 NFKC 会误伤。
 * 先判断文本含汉字才转换，纯假名/拉丁文本直接原样返回。
 * @param text - 原始歌词文本
 */
const normalizeHan = (text: string): string =>
  HAS_HAN_RE.test(text)
    ? text.replace(COMPAT_RE, (char) => RADICAL_SUPPLEMENT_TO_HAN[char] ?? char.normalize("NFKC"))
    : text;

/**
 * 将康熙部首、CJK 部首补充、兼容表意文字等同形异码字符还原为标准汉字
 * @param text - 原始歌词文本
 */
export const normalizeKangxi = (text: string): string => normalizeHan(text);
