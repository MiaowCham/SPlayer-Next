/**
 * TTML 歌词美化/压缩
 *
 * 美化：把压缩的 TTML 重新序列化为带缩进/换行的可读形式；
 *       词与词之间若有空格（位于两个 span 之间），用 <space/> 标记，
 *       避免格式化时把有意义的空格吞掉。
 * 压缩：把 <space/> 还原为实际空格，并压回一行紧凑 TTML（实际保存格式）。
 */

/** 转义 XML 文本 */
const escapeText = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 序列化属性（保留原有属性与命名空间前缀） */
const serializeAttrs = (el: Element): string =>
  Array.from(el.attributes)
    .map((attr) => ` ${attr.name}="${escapeText(attr.value)}"`)
    .join("");

/**
 * 递归美化一个元素（保留结构，词间空格标记为 <space/>）。
 * 叶子文本元素输出单行 `<tag>text</tag>`；容器元素子元素各自一行。
 * @param el 待美化元素
 * @param depth 当前缩进层级
 * @param out 输出数组
 */
const prettyNode = (el: Element, depth: number, out: string[]): void => {
  const indent = "  ".repeat(depth);
  const tagName = el.localName;
  const attrs = serializeAttrs(el);
  const textChildren = Array.from(el.childNodes).filter(
    (n) => n.nodeType === Node.TEXT_NODE,
  ) as Text[];

  // 无子元素且无有效文本：自闭合
  if (el.children.length === 0 && !textChildren.some((n) => n.textContent?.trim())) {
    out.push(`${indent}<${tagName}${attrs}/>`);
    return;
  }

  // 只有文本、无子元素：叶子内容单行（元素与文本同行）；词间空格仍标记 <space/>
  if (el.children.length === 0) {
    const parts: string[] = [];
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? "";
        if (text.trim()) parts.push(escapeText(text.trim()));
        else if (text.includes(" ") || text.includes("\u3000")) parts.push("<space/>");
      }
    }
    const inner = parts.join("");
    if (!inner) {
      out.push(`${indent}<${tagName}${attrs}/>`);
      return;
    }
    out.push(`${indent}<${tagName}${attrs}>${inner}</${tagName}>`);
    return;
  }

  // 容器元素：子元素各自一行
  out.push(`${indent}<${tagName}${attrs}>`);
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      prettyNode(child as Element, depth + 1, out);
    } else if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? "";
      if (!text.trim()) {
        // 词间/标签间的有意义空格，用 <space/> 标记，防止被格式化吞掉
        if (text.includes(" ") || text.includes("\u3000")) {
          out.push(`${indent}  <space/>`);
        }
      }
    }
  }
  out.push(`${indent}</${tagName}>`);
};

/**
 * 把压缩 TTML 解析为 DOM 文档。
 * @param compact 压缩 TTML 文本
 */
const parseTtml = (compact: string): Document | null => {
  try {
    const doc = new DOMParser().parseFromString(compact, "application/xml");
    return doc.querySelector("parsererror") ? null : doc;
  } catch {
    return null;
  }
};

/**
 * 美化压缩 TTML。
 * @param compact 压缩 TTML 文本
 * @returns 美化后的 TTML；无法解析时返回原文本
 */
export const compactTtmlToPretty = (compact: string): string => {
  const doc = parseTtml(compact);
  if (!doc) return compact;
  const out: string[] = [];
  prettyNode(doc.documentElement as Element, 0, out);
  return out.join("\n");
};

/** 序列化紧凑形式：<space/> 元素还原为空格，非空白文本原样，缩进空白忽略 */
const compactNode = (el: Element, out: string[]): void => {
  const tagName = el.localName;
  const attrs = serializeAttrs(el);
  const textChildren = Array.from(el.childNodes).filter(
    (n) => n.nodeType === Node.TEXT_NODE,
  ) as Text[];

  if (el.children.length === 0 && !textChildren.some((n) => n.textContent?.trim())) {
    out.push(`<${tagName}${attrs}/>`);
    return;
  }

  out.push(`<${tagName}${attrs}>`);
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const childEl = child as Element;
      if (childEl.localName === "space") {
        out.push(" ");
      } else {
        compactNode(childEl, out);
      }
    } else if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? "";
      // 忽略纯空白（缩进/换行），输出 trim 后的有意义文本
      if (text.trim()) out.push(escapeText(text.trim()));
    }
  }
  out.push(`</${tagName}>`);
};

/**
 * 压缩美化 TTML：把 <space/> 还原为实际空格，并压回一行紧凑 TTML。
 * @param pretty 美化 TTML 文本
 */
export const prettyTtmlToCompact = (pretty: string): string => {
  const doc = parseTtml(pretty);
  if (!doc) return pretty;
  const out: string[] = [];
  compactNode(doc.documentElement as Element, out);
  return out.join("");
};
