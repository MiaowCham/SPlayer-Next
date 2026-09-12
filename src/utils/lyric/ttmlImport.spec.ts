import { describe, expect, it } from "vitest";
import { normalizeTtml } from "@shared/utils/ttml";
import { parseTTML } from "./parseTTML";
import { compactTtmlToPretty, prettyTtmlToCompact } from "./ttmlBeautify";
import { promotePronunciation } from "@/components/player/Lyrics/romanization";

const wrap = (words: string) =>
  `<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="0s" end="2s">${words}</p></div></body></tt>`;
const first = '<span begin="0s" end="1s">Hello</span>';
const second = '<span begin="1s" end="2s">world</span>';

describe("格式化 TTML 导入与播放", () => {
  it("仅 XML 声明后换行不把紧凑歌词误判为格式化文件", () => {
    const raw = '<?xml version="1.0"?>\n' + wrap(first + " " + second);
    expect(normalizeTtml(raw)).toEqual({
      content: raw,
      formatted: false,
      missingExplicitSpaces: false,
    });
  });
  it("仅紧凑文本的 span 间空格保持原义", () => {
    const raw = wrap(first + "  " + second);
    expect(normalizeTtml(raw).content).toBe(raw);
    expect(
      parseTTML(raw)[0]
        .words.map((word) => word.word)
        .join(""),
    ).toBe("Hello  world");
  });

  it("格式化文件忽略所有元素间空白，并报告缺少合法空格", () => {
    const result = normalizeTtml(wrap("\n    " + first + "  \n    " + second + "\n"));
    expect(result.formatted).toBe(true);
    expect(result.missingExplicitSpaces).toBe(true);
    expect(
      parseTTML(result.content)[0]
        .words.map((word) => word.word)
        .join(""),
    ).toBe("Helloworld");
  });

  it("仅外层缩进的格式化文件也忽略歌词元素间空格", () => {
    const raw = wrap(first + " " + second).replace("<body>", "\n  <body>");
    const result = normalizeTtml(raw);
    expect(result.formatted).toBe(true);
    expect(result.missingExplicitSpaces).toBe(true);
    expect(
      parseTTML(raw)[0]
        .words.map((word) => word.word)
        .join(""),
    ).toBe("Helloworld");
  });

  it.each([
    first + "\n <space/>\n" + second,
    first.replace("Hello</span>", "Hello </span>") + "\n" + second,
    first + "\n<span> </span>\n" + second,
  ])("显式空格往返和播放一致：%s", (words) => {
    const raw = wrap("\n" + words + "\n");
    const result = normalizeTtml(raw);
    expect(result.missingExplicitSpaces).toBe(false);
    expect(result.content).not.toContain("<space");
    expect(
      parseTTML(raw)[0]
        .words.map((word) => word.word)
        .join(""),
    ).toBe("Hello world");
    const back = prettyTtmlToCompact(compactTtmlToPretty(raw));
    expect(
      parseTTML(back)[0]
        .words.map((word) => word.word)
        .join(""),
    ).toBe("Hello world");
  });

  it("元数据中的空格不充当歌词分词空格，带引号属性和命名空间保持合法", () => {
    const raw = wrap("\n" + first + "\n" + second + "\n").replace(
      "<body>",
      '<head><metadata title="Hello &quot;world&quot;"/></head><body>',
    );
    const result = normalizeTtml(raw);
    expect(result.missingExplicitSpaces).toBe(true);
    const back = prettyTtmlToCompact(compactTtmlToPretty(result.content));
    expect(
      new DOMParser().parseFromString(back, "application/xml").querySelector("parsererror"),
    ).toBeNull();
  });

  it("保留音译 span 之间的手工分隔，不再为 CJK 逐字补空格", () => {
    const raw = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:i="urn:test"><head><i:transliterations><i:transliteration><i:text for="L1"><span begin="0s" end="1s">ni</span>  <span begin="1s" end="2s">hao</span></i:text></i:transliteration></i:transliterations></head><body><div><p begin="0s" end="2s" i:key="L1"><span begin="0s" end="1s">你</span><span begin="1s" end="2s">好</span></p></div></body></tt>`;
    const line = parseTTML(raw)[0];
    expect(line.words.map((word) => word.romanWord)).toEqual(["ni  ", "hao"]);
    expect(promotePronunciation(line, "word").words.map((word) => word.word)).toEqual([
      "ni  ",
      "hao",
    ]);
  });
});
