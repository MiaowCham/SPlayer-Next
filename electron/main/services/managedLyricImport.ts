import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { callNetease } from "@main/apis/netease";
import { setManagedLyric } from "@main/database/managedLyrics";
import { extractTtmlMeta } from "@main/services/localLyricRepo";
import { coreLog } from "@main/utils/logger";
import type { Track } from "@shared/types/player";

/** 批量导入网易云 TTML 的统计结果 */
export interface TtmlImportResult {
  imported: number;
  replaced: number;
  skipped: number;
  failed: number;
}

const collectTtml = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === ".ttml") out.push(full);
    }
  };
  await walk(dir);
  return out;
};

interface PendingTtml {
  content: string;
  file: string;
  id: string;
}

/** 为网易云封面 URL 设置列表缩略图尺寸。 */
const neteaseCover = (url: string): string => {
  if (/([?&])param=\d+y\d+/i.test(url)) {
    return url.replace(/([?&])param=\d+y\d+/i, "$1param=300y300");
  }
  return `${url}${url.includes("?") ? "&" : "?"}param=300y300`;
};

/** 将网易云歌曲详情转换为应用曲目数据。 */
const toTrack = (song: any): Track => {
  const album = song.al ?? song.album;
  const artists = song.ar ?? song.artists ?? [];
  const coverOriginal = album?.picUrl as string | undefined;
  return {
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
  };
};

/** 按网易云 ID 批量补全曲目数据；接口未返回的 ID 会保留为孤立歌词。 */
const resolveTracks = async (ids: string[]): Promise<Map<string, Track>> => {
  if (ids.length === 0) return new Map();
  try {
    const { status, body } = await callNetease("song_detail", { ids: ids.join(",") });
    if (status !== 200) return new Map();
    return new Map((body.songs ?? []).map((song: any) => [String(song.id), toTrack(song)]));
  } catch (error) {
    coreLog.warn("[lyrics] 批量导入网易云 TTML 时补全曲目数据失败", error);
    return new Map();
  }
};

/** 导入目录内带网易云元数据的 TTML 文件 */
export const importNeteaseTtmlDirectory = async (dir: string): Promise<TtmlImportResult> => {
  const result: TtmlImportResult = { imported: 0, replaced: 0, skipped: 0, failed: 0 };
  const pending: PendingTtml[] = [];
  for (const file of await collectTtml(dir)) {
    try {
      const content = await readFile(file, "utf8");
      const meta = extractTtmlMeta(content);
      if (!meta.ncmId) {
        result.skipped++;
        continue;
      }
      pending.push({ content, file, id: meta.ncmId });
    } catch {
      result.failed++;
    }
  }

  const tracks = await resolveTracks([...new Set(pending.map((item) => item.id))]);
  for (const item of pending) {
    try {
      setManagedLyric(
        tracks.get(item.id) ?? { source: "netease", id: item.id },
        { content: item.content, format: "ttml" },
        basename(item.file),
      );
      result.imported++;
    } catch {
      result.failed++;
    }
  }
  return result;
};
