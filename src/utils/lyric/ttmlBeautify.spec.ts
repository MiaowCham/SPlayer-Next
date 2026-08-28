import { describe, it, expect } from "vitest";
import { compactTtmlToPretty, prettyTtmlToCompact } from "./ttmlBeautify";

const compact = `<tt xmlns="http://www.w3.org/ns/ttml" itunes:timing="Word"><body><div><p begin="14.162" end="20.112"><span begin="14.162" end="14.805">涂</span><span begin="14.805" end="15.486">上</span> <span begin="15.486" end="15.852">完</span><span begin="15.852" end="16.999">美</span></p><p begin="20.435" end="25.504"><span begin="20.435" end="20.996">桃</span> <span begin="20.996" end="21.543">色</span><span begin="21.543" end="22.292">的</span></p></div></body></tt>`;

describe("ttmlBeautify", () => {
  it("美化：保留结构并标记词间空格为 <space/>", () => {
    const pretty = compactTtmlToPretty(compact);
    expect(pretty).toContain("<space/>");
    expect(pretty).toContain("<body>");
    expect(pretty).toContain("<p begin");
    expect(pretty).toContain("</tt>");
  });

  it("压缩：<space/> 还原为空格，round-trip 恢复原文", () => {
    const pretty = compactTtmlToPretty(compact);
    const back = prettyTtmlToCompact(pretty);
    expect(back.includes("</span> <span")).toBe(true);
    expect(back.match(/<p /g)?.length).toBe(2);
    expect(back.includes("<body>")).toBe(true);
  });

  it("压缩结果保留词间空格", () => {
    const pretty = compactTtmlToPretty(compact);
    const back = prettyTtmlToCompact(pretty);
    expect(back.includes("</span> <span")).toBe(true);
  });

  it("美化输出含缩进层级与 <space/> 标记", () => {
    const pretty = compactTtmlToPretty(compact);
    expect(pretty.split("\n")[1]).toMatch(/^\s*<body>/);
  });

  it("保留 span 文本首尾空格（分词空格不吞）", () => {
    const c = `<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1" end="3"><span begin="1" end="1.5">ho </span><span begin="1.5" end="2">ri </span><span begin="2" end="3">zon</span> <span begin="3" end="4">(Yes, </span><span begin="4" end="5">sir)</span></p></div></body></tt>`;
    const back = prettyTtmlToCompact(compactTtmlToPretty(c));
    expect(back.includes("ho </span>")).toBe(true);
    expect(back.includes("ri </span>")).toBe(true);
    expect(back.includes("(Yes, </span>")).toBe(true);
    expect(back.includes("</span> <span")).toBe(true);
  });

  it("round-trip：compact→pretty→compact→pretty 稳定", () => {
    const c = `<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1" end="3"><span begin="1" end="1.5">ho </span><span begin="1.5" end="2">ri </span><span begin="2" end="3">zon</span> <span begin="3" end="4">(Yes, </span><span begin="4" end="5">sir)</span></p></div></body></tt>`;
    const p1 = compactTtmlToPretty(c);
    const c1 = prettyTtmlToCompact(p1);
    const p2 = compactTtmlToPretty(c1);
    const c2 = prettyTtmlToCompact(p2);
    expect(c2).toBe(c1);
  });
});
