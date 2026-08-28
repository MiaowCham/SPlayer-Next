import { describe, it, expect } from "vitest";
import { normalizeKangxi } from "./kangxi";

describe("normalizeKangxi", () => {
  it("还原 CJK 部首补充的简化部首为标准汉字", () => {
    expect(normalizeKangxi("看⻅⻜吻")).toBe("看见飞吻");
    expect(normalizeKangxi("红⾊的")).toBe("红色的");
    expect(normalizeKangxi("都⽆瑕")).toBe("都无瑕");
    expect(normalizeKangxi("⼀等星")).toBe("一等星");
  });

  it("还原常见的简化部首集合", () => {
    expect(normalizeKangxi("⻜ ⻢ ⻥ ⻦ ⻔ ⻓ ⻋ ⻛")).toBe("飞 马 鱼 鸟 门 长 车 风");
  });

  it("不动纯假名、拉丁与全角字母数字", () => {
    expect(normalizeKangxi("こんにちは")).toBe("こんにちは");
    expect(normalizeKangxi("hello world")).toBe("hello world");
    expect(normalizeKangxi("ＡＢＣ")).toBe("ＡＢＣ");
  });
});
