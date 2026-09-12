// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Track } from "@shared/types/player";

const runtime = vi.hoisted(() => ({ dir: "" }));
vi.mock("@main/store", () => ({
  store: { get: (key: string) => (key === "localLyric.repoDir" ? runtime.dir : true) },
}));
vi.mock("@main/database/lyricMatchCache", () => ({
  buildFingerprint: () => "fingerprint",
  getMatchedId: () => null,
}));
vi.mock("@main/utils/logger", () => ({
  coreLog: { info: vi.fn(), warn: vi.fn() },
}));
import { matchLocalTTML } from "./localLyricRepo";

const track: Track = {
  id: "123",
  source: "netease",
  title: "测试",
  artists: [{ name: "歌手" }],
  duration: 2000,
};
const ttml = (
  space: string,
) => `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:amll="urn:amll"><head><metadata><amll:meta key="ncmMusicId" value="123"/><amll:meta key="musicName" value="测试"/><amll:meta key="artists" value="歌手"/></metadata></head><body><div><p begin="0s" end="2s">
<span begin="0s" end="1s">Hello</span>${space}
<span begin="1s" end="2s">world</span>
</p></div></body></tt>`;

beforeEach(() => {
  runtime.dir = fs.mkdtempSync(path.join(os.tmpdir(), "splayer-ttml-"));
});
afterEach(() => {
  fs.rmSync(runtime.dir, { recursive: true, force: true });
});

describe("本地 TTML 格式化文件回退", () => {
  it("同一平台 ID 的第一份文件无合法空格时尝试下一份", async () => {
    fs.writeFileSync(path.join(runtime.dir, "a.ttml"), ttml(""));
    const valid = ttml("<space/>");
    fs.writeFileSync(path.join(runtime.dir, "b.ttml"), valid);
    expect(await matchLocalTTML(track)).toBe(valid);
  });

  it("按标题匹配也会尝试后续合法候选", async () => {
    fs.writeFileSync(path.join(runtime.dir, "a.ttml"), ttml(""));
    const valid = ttml("<space/>");
    fs.writeFileSync(path.join(runtime.dir, "b.ttml"), valid);
    expect(await matchLocalTTML(track, true)).toBe(valid);
  });

  it("所有候选无效时返回 null，让调用方继续其他歌词来源", async () => {
    fs.writeFileSync(path.join(runtime.dir, "a.ttml"), ttml(""));
    fs.writeFileSync(path.join(runtime.dir, "b.ttml"), ttml("  "));
    expect(await matchLocalTTML(track)).toBeNull();
    expect(await matchLocalTTML(track, true)).toBeNull();
  });
});
