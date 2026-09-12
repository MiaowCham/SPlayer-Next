import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";

interface XmlNode {
  [key: string]: unknown;
  "#text"?: string;
  ":@"?: Record<string, string>;
}

export interface NormalizedTtml {
  content: string;
  formatted: boolean;
  missingExplicitSpaces: boolean;
}

/**
 * 识别并压缩排版后的 TTML，仅显式 space 元素和叶子文本内的空格参与歌词排版。
 * 主进程导入、词库匹配与渲染端编辑共用此规则，避免同一文件在不同入口含义不同。
 * @param text - 原始或已美化的 TTML
 * @returns 可直接解析和保存的紧凑文本，以及格式化文件的空格检查结果
 */
export const normalizeTtml = (text: string): NormalizedTtml => {
  const hasSpaceElement = /<(?:[\w.-]+:)?space\s*\/?\s*>/u.test(text);
  if (!/>[\t \r\n]*[\r\n][\t \r\n]*</u.test(text) && !hasSpaceElement) {
    return { content: text, formatted: false, missingExplicitSpaces: false };
  }
  if (XMLValidator.validate(text) !== true) throw new Error("TTML XML 格式无效");
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    trimValues: false,
    parseTagValue: false,
    parseAttributeValue: false,
    commentPropName: "#comment",
    cdataPropName: "#cdata",
  });
  const nodes = parser.parse(text) as XmlNode[];
  let formatted = false;
  let explicitSpaces = false;

  /** 忽略 XML 声明外的换行；只用歌词区文本判断合法分词空格。 */
  const inspect = (items: XmlNode[], inLyric = false, inElement = false): void => {
    const hasElements = items.some((item) =>
      Object.keys(item).some((key) => !key.startsWith("#") && key !== ":@"),
    );
    for (const node of items) {
      if (typeof node["#text"] === "string") {
        const value = node["#text"];
        if (inElement && hasElements && !value.trim() && /[\r\n]/u.test(value)) formatted = true;
        if (inLyric && !hasElements && /[ \t\u3000]/u.test(value)) explicitSpaces = true;
      }
      for (const [tag, children] of Object.entries(node)) {
        if (!Array.isArray(children)) continue;
        const localName = tag.split(":").at(-1);
        const lyric =
          inLyric || localName === "p" || (localName === "text" && !!node[":@"]?.["@_for"]);
        if (lyric && localName === "space") explicitSpaces = true;
        inspect(children as XmlNode[], lyric, true);
      }
    }
  };
  inspect(nodes);
  if (!formatted && !hasSpaceElement) {
    return { content: text, formatted: false, missingExplicitSpaces: false };
  }

  /** 仅移除元素之间的缩进；叶子 span 的首尾空格及空白 span 原样保留。 */
  const compact = (items: XmlNode[]): XmlNode[] => {
    const hasElements = items.some((item) =>
      Object.keys(item).some((key) => !key.startsWith("#") && key !== ":@"),
    );
    return items.flatMap((node): XmlNode[] => {
      if (formatted && hasElements && typeof node["#text"] === "string" && !node["#text"].trim()) {
        return [];
      }
      for (const [tag, children] of Object.entries(node)) {
        if (!Array.isArray(children)) continue;
        if (tag.split(":").at(-1) === "space") return [{ "#text": " " }];
        node[tag] = compact(children as XmlNode[]);
      }
      return [node];
    });
  };
  const content = new XMLBuilder({
    preserveOrder: true,
    ignoreAttributes: false,
    suppressEmptyNode: true,
    commentPropName: "#comment",
    cdataPropName: "#cdata",
  }).build(compact(nodes)) as string;
  return { content, formatted, missingExplicitSpaces: formatted && !explicitSpaces };
};
