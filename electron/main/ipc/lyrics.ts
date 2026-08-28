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
import {
  fetchAppleMusicTTML,
  fetchAppleMusicTTMLResult,
  getCachedAppleMusicTTML,
  verifyAppleMusicTTMLToken,
} from "@main/services/appleMusicLyrics";
import {
  getAppleMusicMediaUserTokenStorage,
  hasAppleMusicMediaUserToken,
  migrateAppleMusicMediaUserTokenStorage,
  saveAppleMusicMediaUserToken,
} from "@main/services/appleMusicLyricsToken";
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
import { coreLog, lyricLog } from "@main/utils/logger";
import { getMainWindow } from "@main/window";
import { getTrackById, searchTracks } from "@main/database/queries";
import { getTracks as getStreamingTracks } from "@main/database/streaming/tracks";
import type {
  LyricFormat,
  LyricInput,
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
    let data: LyricMatchResult | null = null;
    switch (platform) {
      case "netease":
        data = await netease.getByPlatformId(id);
        break;
      case "qqmusic":
        data = await qqmusic.getByPlatformId(id);
        break;
      case "kugou":
        data = await kugou.getByPlatformId(id);
        break;
      default:
        return { ok: false, error: `unsupported platform: ${platform}` };
    }
    lyricLog.info(
      `[matchById] ${platform}:${id} → ${data ? `hit ${data.format}` : "miss"}`,
    );
    return { ok: true, data };
  } catch (err) {
    coreLog.warn(`[lyrics] matchById(${platform}, ${id}) failed:`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

/** 按 Track 元数据 fuzzy 匹配 */
const resolveByQuery = async (platform: Platform, track: Track): Promise<LyricMatchResponse> => {
  try {
    let data: LyricMatchResult | null = null;
    switch (platform) {
      case "netease":
        data = await netease.getByQuery(track);
        break;
      case "qqmusic":
        data = await qqmusic.getByQuery(track);
        break;
      case "kugou":
        data = await kugou.getByQuery(track);
        break;
      default:
        return { ok: false, error: `unsupported platform: ${platform}` };
    }
    lyricLog.info(
      `[matchByQuery] ${platform} "${track.title}" → ${data ? `hit ${data.format}` : "miss"}`,
    );
    return { ok: true, data };
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
  forceQuery = false,
): Promise<LyricTTMLResponse> => {
  try {
    const ids: string[] = [];
    const push = (v?: string) => {
      if (v && !ids.includes(v)) ids.push(v);
    };
    // 自定义搜索必须先走标题/歌手匹配，避免当前歌曲 ID 绕过用户输入。
    if (forceQuery) await resolveByQuery(platform, track);
    const fingerprint = buildFingerprint(track);
    const cached = getMatchedId(fingerprint, platform);
    // QM mid 放前面（AMLL DB 早期 QM 条目以 mid 为文件名的居多）
    if (platform === "qqmusic") push(cached?.extra?.mid);
    if (!forceQuery && track.source === platform) push(track.id);
    // QM 在线 Track 默认走 byId
    if (!forceQuery && track.source === platform) push(track.extId);
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

/** 应用单曲自定义搜索条件，并标记后续请求不得回退到原曲目 ID。 */
const getSearchTrack = (track: Track): { track: Track; forceQuery: boolean } => {
  const search = getTrackLyricPreference(track)?.search;
  const title = search?.title.trim();
  const artist = search?.artist.trim();
  if (!title && !artist) return { track, forceQuery: false };
  return {
    track: {
      ...track,
      title: title || track.title,
      artists: artist ? [{ ...track.artists[0], name: artist }] : track.artists,
    },
    forceQuery: true,
  };
};

/** 汇总本地版本、平台、本地 TTML 与 AMLL 候选。 */
/** 读取与本地歌词通过文件名固定关系关联的翻译/发音文件（如 netease.yrc 与 netease_trans.lrc）。 */
const readLinkedTranslation = async (
  dir: string,
  origin: string,
): Promise<{ translation: string; translationFormat: LyricFormat } | undefined> => {
  try {
    const transPath = path.join(dir, `${origin}_trans.lrc`);
    const content = await fs.readFile(transPath, "utf8");
    return content.trim() ? { translation: content, translationFormat: "lrc" } : undefined;
  } catch {
    return undefined;
  }
};

const readLinkedRomaji = async (
  dir: string,
  origin: string,
): Promise<{ romaji: string; romajiFormat: LyricFormat } | undefined> => {
  try {
    const romaPath = path.join(dir, `${origin}_roma.lrc`);
    const content = await fs.readFile(romaPath, "utf8");
    return content.trim() ? { romaji: content, romajiFormat: "lrc" } : undefined;
  } catch {
    return undefined;
  }
};

/** 仅返回本地/managed 歌词候选（不含在线搜索），供歌词管理面板先显示本地候选。 */
const getTrackCandidatesLocal = async (track: Track): Promise<LyricMatchCandidate[]> => {
  refreshManagedLyricVersions(track);
  const active = getManagedLyric(track);
  const dir = getManagedTrackLyricsDir(track);
  return Promise.all(
    listManagedLyricVersions(track).map(async (version): Promise<LyricMatchCandidate> => {
      const linkedTrans = version.translation
        ? undefined
        : await readLinkedTranslation(dir, version.origin);
      const linkedRoma = version.romaji ? undefined : await readLinkedRomaji(dir, version.origin);
      return {
        id: version.versionId,
        origin: version.origin,
        format: version.format,
        filename: version.filename ?? `${version.origin}.${version.format}`,
        content: version.content,
        translation: version.translation ?? linkedTrans?.translation,
        translationFormat: version.translationFormat ?? linkedTrans?.translationFormat,
        romaji: version.romaji ?? linkedRoma?.romaji,
        romajiFormat: version.romajiFormat ?? linkedRoma?.romajiFormat,
        active: version.versionId === active?.versionId,
        local: true,
        importedAt: version.importedAt,
      };
    }),
  );
};

/** 搜索并返回某曲目的所有候选歌词（本地 + 在线）。 */
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

  const search = getSearchTrack(track);
  const searchTrack = search.track;
  const platforms: Platform[] = ["netease", "qqmusic", "kugou"];
  const [platformResponses, localTtml] = await Promise.all([
    Promise.all(
      platforms.map(async (platform) => {
        const lookupId = platform === "qqmusic" ? (track.extId ?? track.id) : track.id;
        try {
          return !search.forceQuery && track.source === platform
            ? await resolveById(platform, lookupId)
            : await resolveByQuery(platform, searchTrack);
        } catch (err) {
          coreLog.warn(`[lyrics] candidate lookup(${platform}) failed:`, err);
          return null;
        }
      }),
    ),
    matchLocalTTML(searchTrack, search.forceQuery).catch(() => null),
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

  const appleMusic = await fetchAppleMusicTTMLResult(searchTrack);
  if (appleMusic.lyric) {
    remote.push({
      id: "appleMusic",
      origin: "appleMusic",
      format: "ttml",
      filename: "apple-music.ttml",
      content: appleMusic.lyric,
      active: false,
      local: false,
      status: appleMusic.status,
      statusMessage: appleMusic.message,
    });
  }

  const overlays = await Promise.all(
    (["netease", "qqmusic"] as const).map(async (platform) => {
      try {
        return {
          platform,
          result: await resolveTTMLOverlay(searchTrack, platform, search.forceQuery),
        };
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
      (candidate.origin === "appleMusic" ||
        !local.some(
          (version) => version.origin === candidate.origin && version.content === candidate.content,
        )) &&
      (candidate.origin === "appleMusic" ||
        candidates.findIndex((item) => item.content === candidate.content) === index),
  );
  return [...local, ...uniqueRemote];
};

/** 可内嵌翻译/发音的格式（无需关联文件）。 */
const EMBEDDED_LYRIC_FORMATS = new Set<LyricFormat>(["ttml", "ttmlLine", "lrcn", "lqe"]);

/**
 * 保存优化后的歌词。
 * - 在线候选：创建本地歌词（文件名 `{origin}.{format}`），翻译/发音（非内嵌格式）按 `{origin}_trans.lrc` / `{origin}_roma.lrc` 关联保存。
 * - 已是本地歌词：直接改写原文件；无修改的保存被拒绝；改写前把旧文件备份为 `.bak`（只留一份）。
 * @returns 是否成功
 */
const saveOptimizedLyric = async (
  track: Track,
  candidate: LyricMatchCandidate,
  input: LyricInput,
): Promise<boolean> => {
  const format = candidate.format;
  const dir = getManagedTrackLyricsDir(track);
  const baseName = `${candidate.origin}.${format}`;
  const mainPath = path.join(dir, baseName);
  const isLocal = candidate.local;

  // 无修改的保存（仅本地歌词）被拒绝
  const unchanged =
    input.content === candidate.content &&
    (input.translation ?? "") === (candidate.translation ?? "") &&
    (input.romaji ?? "") === (candidate.romaji ?? "");
  if (isLocal && unchanged) return false;

  // 已是本地歌词：改写前备份旧文件为 .bak（只留一份）
  if (isLocal) {
    try {
      await fs.access(mainPath);
      await fs.copyFile(mainPath, `${mainPath}.bak`);
    } catch {
      // 旧文件不存在则跳过备份
    }
  }

  // 非内嵌格式：把翻译/发音写成关联文件（文件名固定关系）
  if (!EMBEDDED_LYRIC_FORMATS.has(format)) {
    await fs.mkdir(dir, { recursive: true });
    if (input.translation?.trim()) {
      await fs.writeFile(path.join(dir, `${candidate.origin}_trans.lrc`), input.translation, "utf8");
    }
    if (input.romaji?.trim()) {
      await fs.writeFile(path.join(dir, `${candidate.origin}_roma.lrc`), input.romaji, "utf8");
    }
  }

  // 写主歌词 + DB 记录（setManagedLyric 内部以同步 fs 写主文件并更新 DB；翻译/发音仅存 DB，供读取）
  setManagedLyric(
    track,
    {
      content: input.content,
      format,
      translation: EMBEDDED_LYRIC_FORMATS.has(format) ? input.translation : undefined,
      translationFormat: EMBEDDED_LYRIC_FORMATS.has(format) ? input.translationFormat : "lrc",
      romaji: EMBEDDED_LYRIC_FORMATS.has(format) ? input.romaji : undefined,
      romajiFormat: EMBEDDED_LYRIC_FORMATS.has(format) ? input.romajiFormat : "lrc",
    },
    baseName,
    candidate.origin,
    true,
  );
  return true;
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
  ipcMain.handle("lyrics:getTrackCandidatesLocal", (_evt, track: Track) =>
    getTrackCandidatesLocal(track),
  );
  ipcMain.handle(
    "lyrics:saveOptimizedLyric",
    (_evt, track: Track, candidate: LyricMatchCandidate, input: LyricInput) =>
      saveOptimizedLyric(track, candidate, input),
  );
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
    dedup(
      `byQuery:${platform}:${track.id}:${track.title}:${track.artists.map((artist) => artist.name).join("/")}`,
      () => resolveByQuery(platform, track),
    ),
  );
  ipcMain.handle(
    "lyrics:log",
    (_evt, level: "info" | "warn" | "error", message: string) => {
      lyricLog[level](`[renderer] ${message}`);
    },
  );
  ipcMain.handle(
    "lyrics:fetchTTMLOverlay",
    (_evt, track: Track, platform: "netease" | "qqmusic", forceQuery = false) =>
      dedup(`ttml:${platform}:${track.id}:${forceQuery ? track.title : ""}`, () =>
        resolveTTMLOverlay(track, platform, forceQuery),
      ),
  );
  ipcMain.handle(
    "lyrics:fetchAppleMusicTTML",
    async (_evt, track: Track): Promise<LyricTTMLResponse> => {
      try {
        return {
          ok: true,
          data: await dedup(`appleMusicTTML:${track.source}:${track.id}`, () =>
            fetchAppleMusicTTML(track),
          ),
        };
      } catch (err) {
        coreLog.warn(`[lyrics] fetchAppleMusicTTML(${track.title}) failed:`, err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
  ipcMain.handle(
    "lyrics:getCachedAppleMusicTTML",
    (_evt, track: Track): LyricTTMLResponse => {
      try {
        return { ok: true, data: getCachedAppleMusicTTML(track) };
      } catch (err) {
        coreLog.warn(`[lyrics] getCachedAppleMusicTTML(${track.title}) failed:`, err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
  ipcMain.handle("lyrics:getAppleMusicTTMLStatus", () => ({
    hasMediaUserToken: hasAppleMusicMediaUserToken(),
    storage: getAppleMusicMediaUserTokenStorage(),
  }));
  ipcMain.handle("lyrics:setAppleMusicMediaUserToken", (_evt, token: string, storage) => ({
    hasMediaUserToken: saveAppleMusicMediaUserToken(token, storage),
    storage: getAppleMusicMediaUserTokenStorage(),
  }));
  ipcMain.handle("lyrics:migrateAppleMusicMediaUserToken", (_evt, storage) => ({
    hasMediaUserToken: migrateAppleMusicMediaUserTokenStorage(storage),
    storage: getAppleMusicMediaUserTokenStorage(),
  }));
  ipcMain.handle("lyrics:verifyAppleMusicTTMLToken", () => verifyAppleMusicTTMLToken());
  ipcMain.handle(
    "lyrics:matchLocalTTML",
    async (_evt, track: Track, forceQuery = false): Promise<LyricTTMLResponse> => {
      try {
        return { ok: true, data: await matchLocalTTML(track, forceQuery) };
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
