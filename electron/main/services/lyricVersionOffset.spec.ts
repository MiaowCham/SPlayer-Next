import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import type { LyricMatchCandidate } from "@shared/types/lyrics";
import { withLyricVersion, lyricVersionId } from "@shared/utils/lyricVersion";

const config = vi.hoisted(() => ({ offsets: {} as Record<string, number> }));
vi.mock("@main/store", () => ({
  store: {
    get: () => config.offsets,
    set: (_path: string, value: Record<string, number>) => {
      config.offsets = value;
    },
  },
}));
const track: Track = { source: "netease", id: "one", title: "歌", artists: [], duration: 3000 };
const candidate: LyricMatchCandidate = {
  id: "version-a",
  origin: "netease",
  platform: "netease",
  format: "lrc",
  content: "a",
  filename: "a.lrc",
  local: false,
  active: false,
};
beforeEach(() => {
  vi.resetModules();
  config.offsets = {};
});

describe("歌词偏移按曲目及版本持久化", () => {
  it("同源两个版本独立保存，当前版本立即广播且重载可恢复", async () => {
    const service = await import("./nowPlaying");
    service.update(track, [], {
      source: "online",
      platform: "netease",
      format: "lrc",
      versionId: candidate.id,
    });
    const changed = vi.fn();
    service.onLyricOffsetChange(changed);
    service.setVersionOffset(track, candidate, 250);
    service.setVersionOffset(track, { ...candidate, id: "version-b" }, -500);
    expect(service.snapshot().lyricOffsetMs).toBe(250);
    expect(changed).toHaveBeenCalledExactlyOnceWith({ trackId: "one", offsetMs: 250 });
    expect(service.getVersionOffset(track, { ...candidate, id: "version-b" })).toBe(-500);
    vi.resetModules();
    const reloaded = await import("./nowPlaying");
    expect(reloaded.getVersionOffset(track, candidate)).toBe(250);
  });

  it("校准零值覆盖旧来源偏移，侧栏修改的是同一个版本记录", async () => {
    config.offsets["one|online:netease"] = 100;
    const service = await import("./nowPlaying");
    expect(service.getVersionOffset(track, candidate)).toBe(100);
    service.setVersionOffset(track, candidate, 0);
    service.update(track, [], {
      source: "online",
      format: "lrc",
      platform: "netease",
      versionId: candidate.id,
    });
    expect(service.snapshot().lyricOffsetMs).toBe(0);
    service.setLyricOffset(track.id, 150);
    expect(service.getVersionOffset(track, candidate)).toBe(150);
    service.setLyricOffset(track.id, 0);
    expect(service.getVersionOffset(track, candidate)).toBe(0);
  });

  it("相同曲目 ID 在其他平台、服务器和账号代次下互不影响", async () => {
    const service = await import("./nowPlaying");
    const first = { ...track, source: "streaming" as const, serverId: "a", serverRevision: 1 };
    service.setVersionOffset(first, candidate, 100);
    for (const other of [track, { ...first, serverId: "b" }, { ...first, serverRevision: 2 }]) {
      expect(service.getVersionOffset(other, candidate)).toBe(0);
    }
  });

  it("主播放与管理面板生成相同在线版本身份，托管文件保留 UUID", () => {
    const id = lyricVersionId("amll", "qqmusic", "你好");
    expect(
      withLyricVersion(
        { source: "online", platform: "qqmusic", provider: "amll", format: "ttml" },
        "你好",
      ).versionId,
    ).toBe(id);
    expect(
      withLyricVersion({ source: "managed", format: "ttml", versionId: "uuid" }, "你好").versionId,
    ).toBe("uuid");
    expect(lyricVersionId("amll", "qqmusic", "你好！")).not.toBe(id);
  });

  it("拒绝非有限偏移并限定范围", async () => {
    const service = await import("./nowPlaying");
    expect(service.setVersionOffset(track, candidate, Infinity)).toBe(0);
    expect(service.setVersionOffset(track, candidate, 99999)).toBe(60000);
    expect(service.setVersionOffset(track, candidate, -99999)).toBe(-60000);
  });
});
