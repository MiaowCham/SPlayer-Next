import type {
  LyricMatchCandidate,
  LyricSearchSong,
  LyricSearchSource,
  LyricSourceSearchPage,
} from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import { lyricVersionId } from "@shared/utils/lyricVersion";
import { isPlatform } from "@shared/types/platform";
import type { Platform } from "@shared/types/platform";
import {
  buildLyricSearchKeyword,
  pickBestCandidate,
  type LyricCandidate,
} from "@main/apis/common/lyric/utils";
import { buildFingerprint, getMatchedId, setMatchedId } from "@main/database/lyricMatchCache";
import * as netease from "@main/apis/common/lyric/netease";
import * as qqmusic from "@main/apis/common/lyric/qqmusic";
import * as kugou from "@main/apis/common/lyric/kugou";
import { callNetease } from "@main/apis/netease";
import { callQQMusic } from "@main/apis/qqmusic";
import { fetchTTML } from "@main/apis/common/lyric/ttml";
import { loadAppleMusicLyricVersion, searchAppleMusicLyricVersions } from "./appleMusicLyrics";
import { readLocalLyricVersion, searchLocalLyricVersions } from "./localLyricRepo";
import { getVersionOffset, setVersionOffset } from "./nowPlaying";
import {
  getManagedLyric,
  listManagedLyricVersions,
  setManagedLyric,
} from "@main/database/managedLyrics";

/**
 * 仅匹配远端曲目身份，AMLL 获取不得连带下载平台原始歌词
 * @param platform - AMLL 绑定的平台
 * @param track - 已应用搜索条件的曲目
 * @returns 可供 TTML 数据库使用的身份
 */
export const resolveLyricSourceMatchId = async (
  platform: Extract<Platform, "netease" | "qqmusic">,
  track: Track,
): Promise<{ id: string; mid?: string } | null> => {
  const fingerprint = buildFingerprint(track);
  const cached = getMatchedId(fingerprint, platform);
  if (cached) return { id: cached.platformId, mid: cached.extra?.mid };
  const keyword = buildLyricSearchKeyword(track);
  if (!keyword) return null;
  let candidates: LyricCandidate<{ id: string; mid?: string }>[] = [];
  if (platform === "netease") {
    const response = await callNetease("search", { keywords: keyword, type: 1, limit: 20 });
    if (response.status !== 200) return null;
    candidates = (response.body?.result?.songs ?? []).map(
      (song: {
        id: number;
        name: string;
        artists?: { name: string }[];
        album?: { name: string };
        duration?: number;
      }) => ({
        name: song.name,
        artist: (song.artists ?? []).map((artist) => artist.name).join(" / "),
        album: song.album?.name,
        duration: song.duration,
        extra: { id: String(song.id) },
      }),
    );
  } else {
    const response = await callQQMusic("search", { keywords: keyword, limit: 25 });
    if (response.code !== 200) return null;
    candidates = (response.songs ?? []).map(
      (song: {
        id: string;
        mid: string;
        name: string;
        artist: string;
        album?: string;
        duration?: number;
      }) => ({
        name: song.name,
        artist: song.artist,
        album: song.album,
        duration: song.duration,
        extra: { id: song.id, mid: song.mid },
      }),
    );
  }
  const best = pickBestCandidate(candidates, track);
  if (!best) return null;
  setMatchedId(
    fingerprint,
    platform,
    best.extra.id,
    best.extra.mid ? { mid: best.extra.mid } : undefined,
  );
  return best.extra;
};

/**
 * 搜索内置来源的元数据分页，平台来源由现有 renderer 平台搜索服务处理
 * @param source - 当前来源
 * @param keyword - 模糊关键词
 * @param offset - 当前页起点
 * @returns 不携带歌词正文的候选页
 */
export const searchSourceTracks = (
  source: LyricSearchSource,
  keyword: string,
  offset: number,
): Promise<LyricSourceSearchPage> => {
  const start = Math.max(0, Math.trunc(offset));
  if (source.origin === "appleMusic") return searchAppleMusicLyricVersions(keyword, start);
  if (source.origin === "localTtml") return searchLocalLyricVersions(keyword, start);
  throw new Error("该来源请使用平台搜索入口");
};

/**
 * 按单个来源及精确曲目读取歌词，不修改自动匹配缓存或其他来源
 * @param source - 选中的来源及绑定平台
 * @param input - 搜索元数据或解析后的曲目 ID
 * @returns 可供预览和保存的完整版本
 */
export const loadSourceVersion = async (
  source: LyricSearchSource,
  input: LyricSearchSong | string,
): Promise<LyricMatchCandidate | null> => {
  let song: LyricSearchSong =
    typeof input === "string" ? { id: input, title: "", artists: [], duration: 0 } : input;
  const platform =
    source.origin === "amll"
      ? source.platform
      : isPlatform(source.origin)
        ? source.origin
        : undefined;
  let result: Pick<
    LyricMatchCandidate,
    "content" | "format" | "translation" | "translationFormat" | "romaji" | "romajiFormat"
  > | null = null;
  if (source.origin === "localTtml") {
    const local = await readLocalLyricVersion(song.id);
    if (!local) return null;
    song = local.song;
    result = { content: local.content, format: "ttml" };
  } else if (source.origin === "appleMusic") {
    const apple = await loadAppleMusicLyricVersion(song);
    if (apple.lyric) result = { content: apple.lyric, format: "ttml" };
  } else if (platform) {
    if (platform === "qqmusic" && !/^\d+$/.test(song.id)) {
      const body = await callQQMusic("song_info", { mid: song.mid ?? song.id });
      if (body.code !== 200 || !body.song?.id) throw new Error("无法解析 QQ 音乐歌曲 mid");
      song = {
        id: String(body.song.id),
        mid: String(body.song.mid),
        title: body.song.name,
        artists: [body.song.artist],
        album: body.song.album,
        duration: body.song.duration,
      };
    }
    if (!song.title && platform === "netease") {
      const response = await callNetease("song_detail", { ids: song.id });
      const info = response.body?.songs?.[0];
      if (info)
        song = {
          id: String(info.id),
          title: info.name,
          artists: (info.ar ?? []).map((artist: { name: string }) => artist.name),
          album: info.al?.name,
          duration: info.dt ?? 0,
        };
    }
    if (source.origin === "amll") {
      if (platform === "kugou") return null;
      const content = await fetchTTML(platform, song.mid ? [song.mid, song.id] : [song.id]);
      if (content) result = { content, format: "ttml" };
    } else if (platform === "netease") result = await netease.getByPlatformId(song.id);
    else if (platform === "qqmusic")
      result = await qqmusic.getByPlatformId(song.id, song.mid, false);
    else
      result = await kugou.getByPlatformId(song.id, {
        source: "kugou",
        id: song.id,
        title: song.title,
        artists: song.artists.map((name) => ({ name })),
        duration: song.duration,
      });
  }
  if (!result?.content.trim()) return null;
  if (!song.title) {
    const title = result.content.match(/\[ti:([^\]\n]*)\]/i)?.[1]?.trim() ?? "";
    const artist = result.content.match(/\[ar:([^\]\n]*)\]/i)?.[1]?.trim();
    song = {
      ...song,
      title,
      artists: artist ? [artist] : [],
      album: result.content.match(/\[al:([^\]\n]*)\]/i)?.[1]?.trim(),
    };
  }
  const extra = platform === "kugou" ? { hash: song.id } : { id: song.id, mid: song.mid };
  return {
    ...result,
    id: lyricVersionId(source.origin, platform, result.content),
    origin: source.origin,
    platform,
    filename: `${source.origin}-${song.id}.${result.format}`,
    active: false,
    local: false,
    status: source.origin === "appleMusic" ? "available" : undefined,
    sourceTrack: song.title ? song : undefined,
    extra,
  };
};

/**
 * 保存精确来源版本为独立托管文件，不改写其他来源或激活版本
 * @param track - 目标播放曲目
 * @param candidate - 已预览的来源版本
 * @returns 带文件 UUID 的已保存版本
 */
export const saveSourceVersion = (
  track: Track,
  candidate: LyricMatchCandidate,
): LyricMatchCandidate => {
  const filename = `${candidate.origin}-${candidate.platform ?? "source"}-${candidate.extra?.hash ?? candidate.extra?.id ?? candidate.id}.${candidate.format}`;
  const existed = listManagedLyricVersions(track).some((item) => item.filename === filename);
  const offset = getVersionOffset(track, candidate);
  setManagedLyric(
    track,
    { ...candidate, sourceExtra: candidate.extra, sourcePlatform: candidate.platform },
    filename,
    candidate.origin,
    false,
  );
  const version = listManagedLyricVersions(track).find((item) => item.filename === filename);
  if (!version) throw new Error("歌词版本保存失败");
  if (!existed) setVersionOffset(track, { ...candidate, id: version.versionId }, offset);
  return {
    ...candidate,
    id: version.versionId,
    filename: version.filename ?? filename,
    local: true,
    active: getManagedLyric(track)?.versionId === version.versionId,
    importedAt: version.importedAt,
  };
};
