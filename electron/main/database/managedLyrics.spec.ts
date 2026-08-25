// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  db: null as Database.Database | null,
  lyricDir: "",
}));

vi.mock("./index", () => ({
  getDb: () => runtime.db,
}));

vi.mock("@main/store", () => ({
  store: {
    get: () => runtime.lyricDir,
    set: (_key: string, value: string) => {
      runtime.lyricDir = value;
    },
    flushImmediate: () => {},
  },
}));

vi.mock("@main/utils/paths", () => ({
  defaultManagedLyricsDir: "",
}));

vi.mock("@main/utils/logger", () => ({
  coreLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  activateManagedLyricVersion,
  attachManagedLnt,
  deleteManagedLyric,
  deleteManagedLyricVersion,
  getManagedLyric,
  getManagedLyricStats,
  importManagedLyric,
  listManagedLyricVersions,
  moveManagedLyricsDir,
  refreshManagedLyricVersions,
  setManagedLyric,
} from "./managedLyrics";

const track = {
  source: "local" as const,
  id: "song-1",
  title: "测试歌曲",
  artists: [{ name: "测试歌手" }],
  duration: 1000,
};

describe("managedLyrics 多版本存储", () => {
  beforeEach(() => {
    runtime.lyricDir = fs.mkdtempSync(path.join(os.tmpdir(), "splayer-managed-"));
    runtime.db = new Database(":memory:");
    runtime.db.exec(`
      CREATE TABLE managed_lyrics (
        track_source TEXT NOT NULL,
        track_id TEXT NOT NULL,
        data TEXT NOT NULL,
        filename TEXT,
        track_json TEXT,
        active_version_id TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (track_source, track_id)
      );
      CREATE TABLE managed_lyric_versions (
        version_id TEXT PRIMARY KEY,
        track_source TEXT NOT NULL,
        track_id TEXT NOT NULL,
        data TEXT NOT NULL,
        filename TEXT NOT NULL COLLATE NOCASE,
        origin TEXT NOT NULL,
        imported_at INTEGER NOT NULL,
        UNIQUE(track_source, track_id, filename)
      );
    `);
  });

  afterEach(() => {
    runtime.db?.close();
    runtime.db = null;
    fs.rmSync(runtime.lyricDir, { recursive: true, force: true });
  });

  it("按来源和歌曲 ID 建目录并保留多个歌词文件", () => {
    setManagedLyric(track, { content: "[00:01]第一版", format: "lrc" }, "first.lrc");
    setManagedLyric(track, { content: "[00:01]第二版", format: "lrc" }, "second.lrc");

    const versions = listManagedLyricVersions(track);
    expect(versions).toHaveLength(2);
    expect(getManagedLyric(track)?.content).toBe("[00:01]第二版");
    expect(fs.readdirSync(path.join(runtime.lyricDir, "local", "song-1"))).toEqual([
      "first.lrc",
      "second.lrc",
    ]);

    const first = versions.find((version) => version.filename === "first.lrc");
    expect(first && activateManagedLyricVersion(track, first.versionId)).toBe(true);
    expect(getManagedLyric(track)?.content).toBe("[00:01]第一版");
  });

  it("导入新文件时保留当前版本，同名文件需要显式覆盖", () => {
    const first = importManagedLyric(
      track,
      { content: "[00:01]第一版", format: "lrc" },
      "Original.LRC",
    );
    const second = importManagedLyric(
      track,
      { content: "[00:01]第二版", format: "lrc" },
      "another.lrc",
    );

    expect(first.status).toBe("imported");
    expect(first.status !== "conflict" && first.activeChanged).toBe(true);
    expect(second.status).toBe("imported");
    expect(second.status !== "conflict" && second.activeChanged).toBe(false);
    expect(getManagedLyric(track)?.content).toBe("[00:01]第一版");

    const conflict = importManagedLyric(
      track,
      { content: "[00:01]覆盖版", format: "lrc" },
      "original.lrc",
    );
    expect(conflict).toMatchObject({ status: "conflict", filename: "Original.LRC" });
    expect(getManagedLyric(track)?.content).toBe("[00:01]第一版");

    const overwritten = importManagedLyric(
      track,
      { content: "[00:01]覆盖版", format: "lrc" },
      "original.lrc",
      true,
    );
    expect(overwritten.status).toBe("overwritten");
    expect(overwritten.status !== "conflict" && overwritten.activeChanged).toBe(true);
    expect(getManagedLyric(track)?.content).toBe("[00:01]覆盖版");
    expect(fs.readdirSync(path.dirname(getManagedLyric(track)?.filePath ?? ""))).toContain(
      "Original.LRC",
    );
  });

  it("将逐字 LNT 附加到当前 LRCN 且不覆盖主歌词", () => {
    const main = "[Lyrics Next]\n[00:01.000,00:02.000,,L1]<00:01.000,00:02.000>你好";
    const lnt =
      "[transliteration: format@LRCN Trans]\n[L1]<00:01.000,00:01.500>ni<00:01.500,00:02.000>hao";
    setManagedLyric(track, { content: main, format: "lrcn" }, "main.lrcn");

    expect(attachManagedLnt(track, lnt, "romaji")).toBe(true);
    const managed = getManagedLyric(track);
    expect(managed?.format).toBe("lrcn");
    expect(managed?.content).toBe(main);
    expect(managed?.romaji).toBe(lnt);
    expect(managed?.romajiFormat).toBe("lnt");
    expect(listManagedLyricVersions(track)).toHaveLength(1);

    const unrelated = "[transliteration: format@LNT]\n[L2]<00:01.000,00:02.000>unrelated";
    expect(attachManagedLnt(track, unrelated, "romaji")).toBe(false);
    expect(getManagedLyric(track)?.romaji).toBe(lnt);
    expect(attachManagedLnt(track, "[transliteration: format@LNT]", "romaji")).toBe(false);
    expect(getManagedLyric(track)?.romaji).toBe(lnt);
  });

  it("拒绝把 LNT 附加到没有行 ID 的歌词", () => {
    setManagedLyric(track, { content: "[00:01]普通歌词", format: "lrc" }, "main.lrc");
    expect(
      attachManagedLnt(
        track,
        "[transliteration: format@LNT]\n[L1]<00:01.000,00:02.000>roman",
        "romaji",
      ),
    ).toBe(false);
    expect(getManagedLyric(track)?.format).toBe("lrc");
  });

  it("删除活跃版本时切换到剩余版本，最后一份也可删除", () => {
    setManagedLyric(track, { content: "[00:01]第一版", format: "lrc" }, "first.lrc");
    setManagedLyric(track, { content: "[00:01]第二版", format: "lrc" }, "second.lrc");
    const versions = listManagedLyricVersions(track);
    const active = getManagedLyric(track);
    const inactive = versions.find((version) => version.versionId !== active?.versionId);

    expect(active && deleteManagedLyricVersion(track, active.versionId)).toBe(true);
    expect(listManagedLyricVersions(track)).toHaveLength(1);
    expect(getManagedLyric(track)?.versionId).toBe(inactive?.versionId);
    expect(inactive && deleteManagedLyricVersion(track, inactive.versionId)).toBe(true);
    expect(listManagedLyricVersions(track)).toHaveLength(0);
    expect(getManagedLyric(track)).toBeNull();
  });

  it("文件删除失败时保留数据库版本记录", () => {
    setManagedLyric(track, { content: "[00:01]第一版", format: "lrc" }, "first.lrc");
    setManagedLyric(track, { content: "[00:01]第二版", format: "lrc" }, "second.lrc");
    const inactive = listManagedLyricVersions(track).find(
      (version) => version.versionId !== getManagedLyric(track)?.versionId,
    );
    const remove = vi.spyOn(fs, "rmSync").mockImplementationOnce(() => {
      throw new Error("file is busy");
    });

    expect(() => inactive && deleteManagedLyricVersion(track, inactive.versionId)).toThrow(
      "file is busy",
    );
    remove.mockRestore();
    expect(listManagedLyricVersions(track)).toHaveLength(2);
  });

  it("对非法字符和大小写不同的歌曲 ID 使用互不碰撞的目录", () => {
    const tracks = ["a/b", "a_b", "ABC", "abc"].map((id) => ({ ...track, id }));
    tracks.forEach((item, index) =>
      setManagedLyric(item, { content: `歌词 ${index}`, format: "lrc" }, "same.lrc"),
    );

    expect(new Set(tracks.map((item) => getManagedLyric(item)?.filePath)).size).toBe(4);
    expect(fs.readdirSync(path.join(runtime.lyricDir, "local"))).toHaveLength(4);
    deleteManagedLyric(tracks[0]);
    expect(getManagedLyric(tracks[0])).toBeNull();
    expect(tracks.slice(1).map((item) => getManagedLyric(item)?.content)).toEqual([
      "歌词 1",
      "歌词 2",
      "歌词 3",
    ]);
  });

  it("可从源曲目读取手动歌词并同步写入其他曲目", () => {
    const target = { ...track, id: "song-2", title: "目标歌曲" };
    setManagedLyric(
      track,
      {
        content: "[00:01]手动导入歌词",
        format: "lrc",
        translation: "[00:01]翻译",
        translationFormat: "lrc",
      },
      "manual.lrc",
      "manual",
    );

    const source = getManagedLyric(track);
    expect(source).not.toBeNull();
    setManagedLyric(target, source!, source!.filename, source!.origin);

    expect(getManagedLyric(target)).toMatchObject({
      content: "[00:01]手动导入歌词",
      translation: "[00:01]翻译",
      filename: "manual.lrc",
      origin: "manual",
    });
  });

  it("通过导入接口写入的手动歌词可作为同步源读取", () => {
    const result = importManagedLyric(
      track,
      { content: "[00:01]导入歌词", format: "lrc" },
      "imported.lrc",
    );

    expect(result).toMatchObject({ status: "imported", activeChanged: true });
    expect(getManagedLyric(track)).toMatchObject({
      content: "[00:01]导入歌词",
      filename: "imported.lrc",
      origin: "manual",
    });
  });

  it("刷新目录时同步新增、修改和删除的歌词文件", () => {
    setManagedLyric(track, { content: "[00:01]旧内容", format: "lrc" }, "first.lrc");
    const directory = path.dirname(getManagedLyric(track)?.filePath ?? "");
    fs.writeFileSync(path.join(directory, "first.lrc"), "[00:01]新内容", "utf8");
    fs.writeFileSync(
      path.join(directory, "second.srt"),
      "1\n00:00:01,000 --> 00:00:02,000\n新增",
      "utf8",
    );

    expect(refreshManagedLyricVersions(track)).toBe(true);
    expect(getManagedLyric(track)?.content).toBe("[00:01]新内容");
    expect(
      listManagedLyricVersions(track)
        .map((item) => item.filename)
        .sort(),
    ).toEqual(["first.lrc", "second.srt"]);

    fs.rmSync(path.join(directory, "first.lrc"));
    expect(refreshManagedLyricVersions(track)).toBe(true);
    expect(getManagedLyric(track)?.filename).toBe("second.srt");
  });

  it("歌词文件暂时读取失败时保留对应数据库版本", () => {
    setManagedLyric(track, { content: "[00:01]保留内容", format: "lrc" }, "busy.lrc");
    const read = vi.spyOn(fs, "readFileSync").mockImplementationOnce(() => {
      throw new Error("file is busy");
    });

    refreshManagedLyricVersions(track);
    read.mockRestore();
    expect(getManagedLyric(track)?.content).toBe("[00:01]保留内容");
    expect(listManagedLyricVersions(track)).toHaveLength(1);
  });

  it("将旧版扁平记录迁移到歌曲目录", () => {
    runtime.db
      ?.prepare(
        `INSERT INTO managed_lyrics
          (track_source, track_id, data, filename, track_json, active_version_id, updated_at)
         VALUES ('local', 'song-1', ?, 'legacy.lrc', ?, NULL, 1)`,
      )
      .run(JSON.stringify({ content: "[00:01]旧版", format: "lrc" }), JSON.stringify(track));
    fs.writeFileSync(path.join(runtime.lyricDir, "local_song-1.lrc"), "旧副本");

    const managed = getManagedLyric(track);
    expect(managed?.content).toBe("[00:01]旧版");
    expect(fs.existsSync(path.join(runtime.lyricDir, "local", "song-1", "legacy.lrc"))).toBe(true);
    expect(fs.existsSync(path.join(runtime.lyricDir, "local_song-1.lrc"))).toBe(false);
  });

  it("递归迁移歌曲目录并统计全部版本", async () => {
    setManagedLyric(track, { content: "[00:01]第一版", format: "lrc" }, "first.lrc");
    setManagedLyric(track, { content: "[00:01]第二版", format: "lrc" }, "second.lrc");
    const source = runtime.lyricDir;
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "splayer-managed-target-"));

    const stats = await moveManagedLyricsDir(target);
    expect(stats.count).toBe(2);
    expect(getManagedLyricStats().size).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(target, "local", "song-1", "first.lrc"))).toBe(true);
    expect(fs.existsSync(source)).toBe(false);
  });

  it("迁移复制失败时保留原目录和配置", async () => {
    setManagedLyric(track, { content: "[00:01]第一版", format: "lrc" }, "first.lrc");
    const source = runtime.lyricDir;
    const target = path.join(os.tmpdir(), `splayer-managed-failed-${Date.now()}`);
    const copy = vi.spyOn(fs.promises, "cp").mockRejectedValueOnce(new Error("copy failed"));

    await expect(moveManagedLyricsDir(target)).rejects.toThrow("copy failed");
    copy.mockRestore();
    expect(runtime.lyricDir).toBe(source);
    expect(fs.existsSync(path.join(source, "local", "song-1", "first.lrc"))).toBe(true);
    fs.rmSync(target, { recursive: true, force: true });
  });
});
