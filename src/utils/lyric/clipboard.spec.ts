import { describe, expect, it } from "vitest";
import { parseLyric } from "./parse";
import { buildClipboardLyric } from "./clipboard";

describe("歌词版本的快捷复制格式", () => {
  const lines = parseLyric(
    {
      content: "[00:01.234]原词甲\n[01:03.456]原词乙",
      translation: "[00:01.234]译文甲\n[01:03.456]译文乙",
      translationFormat: "lrc",
    },
    "lrc",
  );
  it.each([
    [false, false, "原词甲\n原词乙"],
    [true, false, "原词甲\n译文甲\n原词乙\n译文乙"],
    [false, true, "[00:01.234]原词甲\n[01:03.456]原词乙"],
    [true, true, "[00:01.234]原词甲\n[00:01.234]译文甲\n[01:03.456]原词乙\n[01:03.456]译文乙"],
  ] as const)("翻译 %s、时间轴 %s", (translation, timestamps, expected) => {
    expect(buildClipboardLyric(lines, translation, timestamps)).toBe(expected);
  });
  it("空版本不产生元数据或空行", () => {
    expect(buildClipboardLyric([], true, true)).toBe("");
  });
});
