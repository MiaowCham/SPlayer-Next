/**
 * 歌词匹配 IPC
 *
 * - lyrics:matchById(platform, id)         按 id 直取
 * - lyrics:matchByQuery(platform, track)   按 Track 元数据模糊搜索
 * - lyrics:fetchTTMLOverlay(track, platform) 抓 AMLL TTML DB 的高质量 TTML
 *
 * 同 key 的并发请求会被 dedup：连按多次切歌只发一次网络。
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ipcMain, dialog, shell } from "electron";
import * as netease from "@main/apis/common/lyric/netease";
import * as qqmusic from "@main/apis/common/lyric/qqmusic";
import * as kugou from "@main/apis/common/lyric/kugou";
import { callNetease } from "@main/apis/netease";
import { fetchTTML } from "@main/apis/common/lyric/ttml";
import { matchLocalTTML } from "@main/services/localLyricRepo";
import { importNeteaseTtmlDirectory } from "@main/services/managedLyricImport";
import { buildFingerprint, getMatchedId } from "@main/database/lyricMatchCache";
import {
  deleteManagedLyric,
  deleteManagedLyricVersion,
  clearManagedLyrics,
  activateManagedLyricVersion,
  attachManagedLnt,
  getManagedLyricStats,
  getManagedLyricsDir,
  getManagedTrackLyricsDir,
  getManagedLyric,
  importManagedLyric,
  listManagedLyrics,
  listManagedLyricVersions,
  moveManagedLyricsDir,
  refreshManagedLyricVersions,
  setManagedLyric,
  updateManagedLyricTrack,
} from "@main/database/managedLyrics";
import { getTrackLyricPreference, setTrackLyricPreference } from "@main/database/lyricPreferences";
import { coreLog } from "@main/utils/logger";
import { getMainWindow } from "@main/window";
import { getTrackById, searchTracks } from "@main/database/queries";
import { getTracks as getStreamingTracks } from "@main/database/streaming/tracks";
import type {
  LyricFormat,
  LyricMatchCandidate,
  LyricMatchResult,
  LyricMatchResponse,
  LyricTTMLResponse,
  ManagedLyricImport,
  ManagedLyricImportResult,
  ManagedLyricMigrationResult,
  TrackLyricPreference,
} from "@shared/types/lyrics";
import type { Platform } from "@shared/types/platform";
import type { Track } from "@shared/types/player";

/** 进行中请求映射 */
const inflight = new Map<string, Promise<unknown>>();

const FORMAT_BY_EXTENSION: Record<string, LyricFormat> = {
  ".ttml": "ttml",
  ".lqe": "lqe",
  ".lys": "lys",
  ".yrc": "yrc",
  ".qrc": "qrc",
  ".krc": "krc",
  ".lrcn": "lrcn",
  ".lnt": "lnt",
  ".lrc": "lrc",
  ".srt": "srt",
  ".ass": "ass",
};

/**
 * 并发去重
 * @param key 唯一键，相同 key 的并发请求共用同一个 Promise
 * @param run 实际执行函数
 */
const dedup = <T>(key: string, run: () => Promise<T>): Promise<T> => {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = run().finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
};

/**
 * 按 (platform, id) 直取
 * @param platform 平台
 * @param id 平台 id
 * @returns 歌词匹配结果
 */
const resolveById = async (platform: Platform, id: string): Promise<LyricMatchResponse> => {
  try {
    switch (platform) {
      case "netease":
        return { ok: true, data: await netease.getByPlatformId(id) };
      case "qqmusic":
        return { ok: true, data: await qqmusic.getByPlatformId(id) };
      case "kugou":
        return { ok: true, data: await kugou.getByPlatformId(id) };
      default:
        return { ok: false, error: `unsupported platform: ${platform}` };
    }
  } catch (err) {
    coreLog.warn(`[lyrics] matchById(${platform}, ${id}) failed:`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

/** 按 Track 元数据 fuzzy 匹配 */
const resolveByQuery = async (platform: Platform, track: Track): Promise<LyricMatchResponse> => {
  try {
    switch (platform) {
      case "netease":
        return { ok: true, data: await netease.getByQuery(track) };
      case "qqmusic":
        return { ok: true, data: await qqmusic.getByQuery(track) };
      case "kugou":
        return { ok: true, data: await kugou.getByQuery(track) };
      default:
        return { ok: false, error: `unsupported platform: ${platform}` };
    }
  } catch (err) {
    coreLog.warn(`[lyrics] matchByQuery(${platform}, ${track.title}) failed:`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

/**
 * 按 Track 解析出对应平台的 TTML 候选 id，依次抓取直至命中。
 * - NCM：track.platform=netease 时用 track.id；其它情况查 match cache 拿数字 id
 * - QM：track.platform=qqmusic 时把 track.id 当数字 id 候选；再叠加 match cache 的 mid + 数字 id
 */
const resolveTTMLOverlay = async (
  track: Track,
  platform: "netease" | "qqmusic",
): Promise<LyricTTMLResponse> => {
  try {
    const ids: string[] = [];
    const push = (v?: string) => {
      if (v && !ids.includes(v)) ids.push(v);
    };
    const fingerprint = buildFingerprint(track);
    const cached = getMatchedId(fingerprint, platform);
    // QM mid 放前面（AMLL DB 早期 QM 条目以 mid 为文件名的居多）
    if (platform === "qqmusic") push(cached?.extra?.mid);
    if (track.source === platform) push(track.id);
    // QM 在线 Track 默认走 byId
    if (track.source === platform) push(track.extId);
    push(cached?.platformId);
    if (ids.length === 0) return { ok: true, data: null };
    return { ok: true, data: await fetchTTML(platform, ids) };
  } catch (err) {
    coreLog.warn(`[lyrics] fetchTTMLOverlay(${platform}, ${track.title}) failed:`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

/** 为在线匹配结果生成稳定的候选 ID。 */
const candidateId = (origin: string, platform: string | undefined, content: string): string =>
  `${origin}:${platform ?? ""}:${createHash("sha256").update(content).digest("hex").slice(0, 16)}`;

/** 将平台匹配结果转换为单曲管理候选。 */
const platformCandidate = (result: LyricMatchResult): LyricMatchCandidate => ({
  id: candidateId(result.platform, result.platform, result.content),
  origin: result.platform,
  platform: result.platform,
  format: result.format,
  filename: `${result.platform}.${result.format}`,
  content: result.content,
  translation: result.translation,
  translationFormat: result.translationFormat,
  romaji: result.romaji,
  romajiFormat: result.romajiFormat,
  active: false,
  local: false,
});

/** 汇总本地版本、平台、本地 TTML 与 AMLL 候选。 */
const getTrackCandidates = async (track: Track): Promise<LyricMatchCandidate[]> => {
  refreshManagedLyricVersions(track);
  const active = getManagedLyric(track);
  const local = listManagedLyricVersions(track).map((version): LyricMatchCandidate => ({
    id: version.versionId,
    origin: version.origin,
    format: version.format,
    filename: version.filename ?? `${version.origin}.${version.format}`,
    content: version.content,
    translation: version.translation,
    translationFormat: version.translationFormat,
    romaji: version.romaji,
    romajiFormat: version.romajiFormat,
    active: version.versionId === active?.versionId,
    local: true,
    importedAt: version.importedAt,
  }));

  const platforms: Platform[] = ["netease", "qqmusic", "kugou"];
  const [platformResponses, localTtml] = await Promise.all([
    Promise.all(
      platforms.map(async (platform) => {
        const lookupId = platform === "qqmusic" ? (track.extId ?? track.id) : track.id;
        try {
          return track.source === platform
            ? await resolveById(platform, lookupId)
            : await resolveByQuery(platform, track);
        } catch (err) {
          coreLog.warn(`[lyrics] candidate lookup(${platform}) failed:`, err);
          return null;
        }
      }),
    ),
    matchLocalTTML(track).catch(() => null),
  ]);
  const remote = platformResponses.flatMap((response) =>
    response?.ok && response.data ? [platformCandidate(response.data)] : [],
  );
  if (localTtml) {
    remote.unshift({
      id: candidateId("localTtml", undefined, localTtml),
      origin: "localTtml",
      format: "ttml",
      filename: "local-ttml.ttml",
      content: localTtml,
      active: false,
      local: false,
    });
  }

  const overlays = await Promise.all(
    (["netease", "qqmusic"] as const).map(async (platform) => {
      try {
        return { platform, result: await resolveTTMLOverlay(track, platform) };
      } catch (err) {
        coreLog.warn(`[lyrics] AMLL candidate lookup(${platform}) failed:`, err);
        return { platform, result: null };
      }
    }),
  );
  for (const { platform, result } of overlays) {
    if (!result?.ok || !result.data) continue;
    remote.unshift({
      id: candidateId("amll", platform, result.data),
      origin: "amll",
      platform,
      format: "ttml",
      filename: `amll-${platform}.ttml`,
      content: result.data,
      active: false,
      local: false,
    });
  }

  const uniqueRemote = remote.filter(
    (candidate, index, candidates) =>
      !local.some(
        (version) => version.origin === candidate.origin && version.content === candidate.content,
      ) && candidates.findIndex((item) => item.content === candidate.content) === index,
  );
  return [...local, ...uniqueRemote];
};

/** 为网易云封面 URL 设置缩略图尺寸。 */
const neteaseCover = (url: string): string => {
  if (/([?&])param=\d+y\d+/i.test(url)) {
    return url.replace(/([?&])param=\d+y\d+/i, "$1param=300y300");
  }
  return `${url}${url.includes("?") ? "&" : "?"}param=300y300`;
};

/** 缺少封面时从权威曲目来源补全元数据。 */
const enrichTrackCover = async (track: Track): Promise<Track> => {
  if (track.cover || track.coverOriginal) return track;
  if (track.source === "local") {
    const local = getTrackById(track.id);
    return local ? { ...track, ...local } : track;
  }
  if (track.source === "streaming" && track.serverId) {
    const streaming = getStreamingTracks(track.serverId).find((item) => item.id === track.id);
    return streaming ? { ...track, ...streaming } : track;
  }
  if (track.source !== "netease") return track;
  try {
    const { status, body } = await callNetease("song_detail", { ids: track.id });
    const song = status === 200 ? body.songs?.[0] : undefined;
    const coverOriginal = song?.al?.picUrl as string | undefined;
    if (!coverOriginal) return track;
    return {
      ...track,
      album: track.album ? { ...track.album, cover: neteaseCover(coverOriginal) } : undefined,
      cover: neteaseCover(coverOriginal),
      coverOriginal,
    };
  } catch (error) {
    coreLog.warn(`[lyrics] 补全歌曲封面失败: ${track.source}:${track.id}`, error);
    return track;
  }
};

export const registerLyricsIpc = (): void => {
  const notifyManagedChange = (track: Pick<Track, "source" | "id"> | null): void => {
    getMainWindow()?.webContents.send(
      "lyrics:managedChanged",
      track ? { source: track.source, id: track.id } : null,
    );
  };
  ipcMain.handle("lyrics:getManaged", (_evt, track: Track) => getManagedLyric(track));
  ipcMain.handle("lyrics:refreshManaged", (_evt, track: Track) => {
    const changed = refreshManagedLyricVersions(track);
    const preference = getTrackLyricPreference(track);
    if (preference?.source === "local") {
      const versions = listManagedLyricVersions(track);
      if (
        preference.versionId &&
        !versions.some((item) => item.versionId === preference.versionId)
      ) {
        const replacement = getManagedLyric(track);
        setTrackLyricPreference(
          track,
          replacement ? { source: "local", versionId: replacement.versionId } : { source: "auto" },
        );
      }
    }
    return changed;
  });
  ipcMain.handle("lyrics:getTrackCandidates", (_evt, track: Track) => getTrackCandidates(track));
  ipcMain.handle("lyrics:getTrackPreference", (_evt, track: Track) =>
    getTrackLyricPreference(track),
  );
  ipcMain.handle(
    "lyrics:setTrackPreference",
    (_evt, track: Track, preference: TrackLyricPreference) => {
      setTrackLyricPreference(track, preference);
      notifyManagedChange(track);
    },
  );
  ipcMain.handle(
    "lyrics:selectTrackCandidate",
    (_evt, track: Track, candidate: LyricMatchCandidate) => {
      return candidate.local ? activateManagedLyricVersion(track, candidate.id) : true;
    },
  );
  ipcMain.handle("lyrics:deleteManagedVersion", (_evt, track: Track, versionId: string) => {
    const preference = getTrackLyricPreference(track);
    const deleted = deleteManagedLyricVersion(track, versionId);
    if (deleted) {
      if (preference?.source === "local" && preference.versionId === versionId) {
        const replacement = getManagedLyric(track);
        setTrackLyricPreference(
          track,
          replacement ? { source: "local", versionId: replacement.versionId } : { source: "auto" },
        );
      }
      notifyManagedChange(track);
    }
    return deleted;
  });
  ipcMain.handle("lyrics:listManaged", async () => {
    const records = listManagedLyrics();
    for (const record of records) {
      if (!record.track || record.track.cover || record.track.coverOriginal) continue;
      const enriched = await enrichTrackCover(record.track);
      if (!enriched.cover && !enriched.coverOriginal) continue;
      updateManagedLyricTrack(enriched);
      record.track = enriched;
    }
    return records;
  });
  ipcMain.handle("lyrics:searchTracks", (_evt, query: string) => searchTracks(query));
  ipcMain.handle("lyrics:searchOnlineTracks", async (_evt, query: string): Promise<Track[]> => {
    const keyword = query.trim();
    if (!keyword) return [];
    try {
      const { status, body } = await callNetease("cloudsearch", {
        keywords: keyword,
        type: 1,
        limit: 20,
      });
      if (status !== 200) return [];
      return await Promise.all(
        (body.result?.songs ?? []).map(async (song: any): Promise<Track> => {
          const album = song.al ?? song.album;
          const artists = song.ar ?? song.artists ?? [];
          const coverOriginal = album?.picUrl as string | undefined;
          return enrichTrackCover({
            id: String(song.id),
            source: "netease",
            title: song.name,
            artists: artists.map((artist: { id?: number; name: string }) => ({
              id: artist.id ? String(artist.id) : undefined,
              name: artist.name,
            })),
            album: album
              ? {
                  id: String(album.id),
                  name: album.name,
                  cover: coverOriginal ? neteaseCover(coverOriginal) : undefined,
                }
              : undefined,
            duration: song.dt ?? song.duration ?? 0,
            cover: coverOriginal ? neteaseCover(coverOriginal) : undefined,
            coverOriginal,
          });
        }),
      );
    } catch (err) {
      coreLog.warn(`[lyrics] searchOnlineTracks(${keyword}) failed:`, err);
      return [];
    }
  });
  ipcMain.handle("lyrics:copyManaged", async (_evt, source: Track, targets: Track[]) => {
    coreLog.info(
      `[lyrics] 开始同步手动歌词: ${source.source}:${source.id} -> ${targets.length} 首歌曲`,
    );
    refreshManagedLyricVersions(source);
    const lyric = getManagedLyric(source);
    if (!lyric) {
      coreLog.warn(`[lyrics] 同步手动歌词失败，未找到源记录: ${source.source}:${source.id}`);
      return 0;
    }
    coreLog.info(
      `[lyrics] 同步源记录: ${source.source}:${source.id}, 版本=${lyric.versionId}, 来源=${lyric.origin}, 文件=${lyric.filename}`,
    );
    let applied = 0;
    for (const rawTarget of targets) {
      try {
        const target = await enrichTrackCover(rawTarget);
        setManagedLyric(target, lyric, lyric.filename, lyric.origin);
        const copied = getManagedLyric(target);
        if (!copied) {
          coreLog.warn(`[lyrics] 同步手动歌词后回读失败: ${target.source}:${target.id}`);
          continue;
        }
        setTrackLyricPreference(target, { source: "local", versionId: copied.versionId });
        notifyManagedChange(target);
        applied++;
      } catch (error) {
        coreLog.error(
          `[lyrics] 同步手动歌词到目标失败: ${rawTarget.source}:${rawTarget.id}`,
          error,
        );
      }
    }
    coreLog.info(`[lyrics] 手动歌词同步完成: ${applied}/${targets.length}`);
    return applied;
  });
  ipcMain.handle("lyrics:removeManaged", (_evt, track: Track) => {
    deleteManagedLyric(track);
    notifyManagedChange(track);
  });
  ipcMain.handle("lyrics:clearManaged", () => {
    clearManagedLyrics();
    notifyManagedChange(null);
  });
  ipcMain.handle("lyrics:getManagedStats", () => getManagedLyricStats());
  ipcMain.handle("lyrics:openManagedDir", () => shell.openPath(getManagedLyricsDir()));
  ipcMain.handle("lyrics:openManagedTrackDir", (_evt, track: Track) =>
    shell.openPath(getManagedTrackLyricsDir(track)),
  );
  ipcMain.handle("lyrics:pickManagedDir", async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: "选择手动导入歌词目录",
      properties: ["openDirectory"],
    });
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  });
  ipcMain.handle(
    "lyrics:moveManagedDir",
    async (_evt, directory: string): Promise<ManagedLyricMigrationResult> => {
      try {
        return { ok: true, stats: await moveManagedLyricsDir(directory) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        coreLog.error(`[lyrics] 手动歌词目录迁移 IPC 失败: ${directory}`, error);
        return { ok: false, error: message };
      }
    },
  );
  ipcMain.handle(
    "lyrics:setManaged",
    (
      _evt,
      track: Track,
      lyric: ManagedLyricImport,
      overwrite = false,
    ): ManagedLyricImportResult => {
      if (lyric.format === "lnt") {
        const declaration = /^\[(translate|transliteration):\s*format@[^\]]+\]/im.exec(
          lyric.content,
        );
        if (!declaration) throw new Error("LNT 文件缺少 translate/transliteration 类型声明");
        const kind = declaration[1].toLowerCase() === "translate" ? "translation" : "romaji";
        if (!attachManagedLnt(track, lyric.content, kind)) {
          throw new Error("LNT 只能附加到包含行 ID 的当前 LRCN 歌词");
        }
        const managed = getManagedLyric(track);
        notifyManagedChange(track);
        return {
          status: "attached",
          versionId: managed?.versionId ?? "",
          activeChanged: true,
        };
      }
      const result = importManagedLyric(track, lyric, lyric.filename, overwrite);
      if (result.status !== "conflict") notifyManagedChange(track);
      return result;
    },
  );
  ipcMain.handle("lyrics:pickManagedFile", async (): Promise<ManagedLyricImport | null> => {
    const result = await dialog.showOpenDialog({
      title: "选择歌词文件",
      properties: ["openFile"],
      filters: [
        {
          name: "歌词文件",
          extensions: Object.keys(FORMAT_BY_EXTENSION).map((ext) => ext.slice(1)),
        },
      ],
    });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return null;
    const format = FORMAT_BY_EXTENSION[path.extname(filePath).toLowerCase()];
    if (!format) return null;
    const content = await fs.readFile(filePath, "utf8");
    return { content, format, filename: path.basename(filePath) };
  });
  ipcMain.handle("lyrics:importNeteaseTtmlDirectory", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择网易云 TTML 歌词目录",
      properties: ["openDirectory"],
    });
    const dir = result.filePaths[0];
    return result.canceled || !dir ? null : importNeteaseTtmlDirectory(dir);
  });
  ipcMain.handle("lyrics:matchById", (_evt, platform: Platform, id: string) =>
    dedup(`byId:${platform}:${id}`, () => resolveById(platform, id)),
  );
  ipcMain.handle("lyrics:matchByQuery", (_evt, platform: Platform, track: Track) =>
    dedup(`byQuery:${platform}:${track.id}`, () => resolveByQuery(platform, track)),
  );
  ipcMain.handle("lyrics:fetchTTMLOverlay", (_evt, track: Track, platform: "netease" | "qqmusic") =>
    dedup(`ttml:${platform}:${track.id}`, () => resolveTTMLOverlay(track, platform)),
  );
  ipcMain.handle(
    "lyrics:matchLocalTTML",
    async (_evt, track: Track): Promise<LyricTTMLResponse> => {
      try {
        return { ok: true, data: await matchLocalTTML(track) };
      } catch (err) {
        coreLog.warn(`[lyrics] matchLocalTTML(${track.title}) failed:`, err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
  ipcMain.handle("lyrics:pickLyricRepoDir", async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: "选择本地 TTML 歌词库目录",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
};
