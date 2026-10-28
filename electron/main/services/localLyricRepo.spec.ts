// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
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

describe("本地 TTML 索引失效", () => {
  it("子目录不可读时仍能匹配其他可读歌词", async () => {
    const nested = path.join(runtime.dir, "locked");
    fs.mkdirSync(nested);
    const valid = ttml("<space/>");
    fs.writeFileSync(path.join(runtime.dir, "a.ttml"), valid);
    const readdir = fsp.readdir.bind(fsp);
    vi.spyOn(fsp, "readdir").mockImplementation((...args) => {
      if (args[0] === nested)
        return Promise.reject(Object.assign(new Error("locked"), { code: "EACCES" }));
      return readdir(...args);
    });
    expect(await matchLocalTTML(track)).toBe(valid);
  });

  it("根目录时间不变时仍发现子目录中的新增、改名与删除", async () => {
    const nested = path.join(runtime.dir, "nested");
    fs.mkdirSync(nested);
    expect(await matchLocalTTML(track)).toBeNull();
    const rootTime = fs.statSync(runtime.dir).mtimeMs;
    const file = path.join(nested, "a.ttml");
    const valid = ttml("<space/>");
    fs.writeFileSync(file, valid);
    expect(fs.statSync(runtime.dir).mtimeMs).toBe(rootTime);
    expect(await matchLocalTTML(track)).toBe(valid);
    const renamed = path.join(nested, "b.ttml");
    fs.renameSync(file, renamed);
    expect(await matchLocalTTML(track)).toBe(valid);
    fs.unlinkSync(renamed);
    expect(await matchLocalTTML(track)).toBeNull();
    expect(fs.statSync(runtime.dir).mtimeMs).toBe(rootTime);
  });

  it("子目录文件修改平台 ID 与标题后不再使用旧索引键", async () => {
    const nested = path.join(runtime.dir, "nested");
    fs.mkdirSync(nested);
    const file = path.join(nested, "a.ttml");
    const original = ttml("<space/>");
    fs.writeFileSync(file, original);
    expect(await matchLocalTTML(track)).toBe(original);
    const rootTime = fs.statSync(runtime.dir).mtimeMs;
    const updated = original
      .replace('value="123"', 'value="456"')
      .replace('value="测试"', 'value="新标题"');
    fs.writeFileSync(file, updated);
    const modified = new Date(Date.now() + 2000);
    fs.utimesSync(file, modified, modified);
    expect(fs.statSync(runtime.dir).mtimeMs).toBe(rootTime);
    expect(await matchLocalTTML(track)).toBeNull();
    expect(await matchLocalTTML({ ...track, id: "456", title: "新标题" })).toBe(updated);
  });

  it("并发切换目录时不会把旧目录的索引交给新请求", async () => {
    const originalDir = runtime.dir;
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "splayer-ttml-"));
    try {
      fs.writeFileSync(path.join(originalDir, "a.ttml"), ttml("<space/>"));
      const first = matchLocalTTML(track);
      runtime.dir = other;
      const second = matchLocalTTML(track);
      await first;
      expect(await second).toBeNull();
    } finally {
      runtime.dir = originalDir;
      fs.rmSync(other, { recursive: true, force: true });
    }
  });
});
