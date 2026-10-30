/**
 * 本地 TTML 歌词库
 *
 * 用户指定一个目录作为 TTML 歌词仓库。按需扫描目录下所有 .ttml，解析 AMLL
 * `<amll:meta>` 头（musicName / artists / ncmMusicId / qqMusicId）建立索引：
 * - 平台 id（NCM / QQ）→ 文件路径（精确命中）
 * - 归一化标题 → 候选列表
 * 命中返回文件原文，交由渲染层 parseTTML 解析。
 *
 * 每次查询核对递归文件清单与文件元数据，变化时重建索引
 * 仅保留路径与小键，不驻留文件内容；命中时按需读盘。
 */

import { readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, extname } from "node:path";
import { readFileAutoEncoding } from "@main/utils/encoding";
import { store } from "@main/store";
import { normalize } from "@main/apis/common/lyric/utils";
import { buildFingerprint, getMatchedId } from "@main/database/lyricMatchCache";
import { coreLog } from "@main/utils/logger";
import type { LyricSearchSong, LyricSourceSearchPage } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import { normalizeTtml } from "@shared/utils/ttml";

/** 同名候选：艺术家仅作区分，不作硬门槛 */
interface NameCandidate {
  /** 归一化首艺术家，缺失为空串 */
  artist: string;
  file: string;
  title?: string;
  artistName?: string;
}

interface RepoIndex {
  byNcm: Map<string, string[]>;
  byQq: Map<string, string[]>;
  /** 归一化标题 → 同名候选 */
  byTitle: Map<string, NameCandidate[]>;
}

interface IndexCache {
  dir: string;
  signature: string;
  index: RepoIndex;
}

let cache: IndexCache | null = null;
let building: { dir: string; promise: Promise<RepoIndex | null> } | null = null;

interface TTMLMeta {
  name?: string;
  artist?: string;
  ncmIds: string[];
  qqIds: string[];
}

/** 从 TTML 文本头部提取 AMLL 元信息 */
export const extractTtmlMeta = (text: string): TTMLMeta => {
  const bodyAt = text.indexOf("<body");
  const head = bodyAt > 0 ? text.slice(0, bodyAt) : text.slice(0, 8000);
  const meta: TTMLMeta = { ncmIds: [], qqIds: [] };
  for (const tag of head.matchAll(/<amll:meta\b[^>]*>/gi)) {
    const key = tag[0].match(/\bkey="([^"]*)"/)?.[1];
    const value = tag[0].match(/\bvalue="([^"]*)"/)?.[1];
    if (!key || !value) continue;
    if (key === "musicName" && !meta.name) meta.name = value;
    else if (key === "artists" && !meta.artist) meta.artist = value;
    else if (key === "ncmMusicId") meta.ncmIds.push(value);
    else if (key === "qqMusicId") meta.qqIds.push(value);
  }
  return meta;
};

/**
 * 递归收集 TTML 路径与元数据摘要，不驻留文件正文
 * @param dir - 歌词仓库目录
 * @returns 文件清单及其变更摘要
 */
const collectTtml = async (dir: string): Promise<{ files: string[]; signature: string }> => {
  const out: string[] = [];
  /**
   * 收集当前目录的文件，跳过不可读子目录以保留其他歌词
   * @param current - 当前目录
   */
  const walk = async (current: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (current === dir) throw error;
      coreLog.warn(`[localLyric] 跳过不可读目录：${current}`, error);
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === ".ttml") out.push(full);
    }
  };
  await walk(dir);
  out.sort();
  const files: string[] = [];
  const hash = createHash("sha256");
  for (const file of out) {
    try {
      const info = await stat(file, { bigint: true });
      hash.update(
        JSON.stringify([file, String(info.size), String(info.mtimeNs), String(info.ctimeNs)]),
      );
      files.push(file);
    } catch (error) {
      coreLog.warn(`[localLyric] 跳过无法读取元数据的文件：${file}`, error);
    }
  }
  return { files, signature: hash.digest("hex") };
};

/**
 * 从本次核对过的文件清单建立索引
 * @param dir - 歌词仓库目录
 * @param files - TTML 文件路径
 * @returns 歌曲元数据索引
 */
const buildIndex = async (dir: string, files: string[]): Promise<RepoIndex> => {
  const index: RepoIndex = { byNcm: new Map(), byQq: new Map(), byTitle: new Map() };
  for (const file of files) {
    let text: string;
    try {
      text = await readFileAutoEncoding(file);
    } catch {
      continue;
    }
    const meta = extractTtmlMeta(text);
    for (const [ids, byId] of [
      [meta.ncmIds, index.byNcm],
      [meta.qqIds, index.byQq],
    ] as const) {
      for (const id of ids) {
        const matches = byId.get(id);
        if (matches) matches.push(file);
        else byId.set(id, [file]);
      }
    }
    if (meta.name) {
      const titleKey = normalize(meta.name);
      const candidate: NameCandidate = {
        title: meta.name,
        artistName: meta.artist,
        artist: normalize(meta.artist ?? ""),
        file,
      };
      const list = index.byTitle.get(titleKey);
      if (list) list.push(candidate);
      else index.byTitle.set(titleKey, [candidate]);
    }
  }
  coreLog.info(`[localLyric] 索引完成：${files.length} 个文件 @ ${dir}`);
  return index;
};

/**
 * 核对递归文件元数据后复用或重建索引，同目录的并发查询共享扫描
 * @returns 当前仓库索引，读取失败时返回 null
 */
const getIndex = async (): Promise<RepoIndex | null> => {
  const dir = store.get("localLyric.repoDir") || "";
  if (!dir) return null;
  if (building) {
    if (building.dir === dir) return building.promise;
    await building.promise;
    return getIndex();
  }
  const promise = (async () => {
    try {
      const { files, signature } = await collectTtml(dir);
      if (cache?.dir === dir && cache.signature === signature) return cache.index;
      const index = await buildIndex(dir, files);
      cache = { dir, signature, index };
      return index;
    } catch (err) {
      coreLog.warn("[localLyric] 索引构建失败：", err);
      return null;
    } finally {
      building = null;
    }
  })();
  building = { dir, promise };
  return promise;
};

/** 按优先级读取候选；格式化文件缺少显式空格时继续下一份，不让坏文件截断回退链。 */
const tryRead = async (files: readonly string[] | undefined): Promise<string | null> => {
  for (const file of files ?? []) {
    try {
      const text = await readFileAutoEncoding(file);
      if (normalizeTtml(text).missingExplicitSpaces) {
        coreLog.warn(`[localLyric] 跳过缺少显式空格的格式化 TTML：${file}`);
        continue;
      }
      return text;
    } catch {
      continue;
    }
  }
  return null;
};

/**
 * 同名候选里按艺术家挑最匹配的；只有一条或无法用艺术家区分时取第一条
 * @param candidates - 同一标题下的候选
 * @param wantArtist - 归一化的目标首艺术家
 * @returns 命中文件路径
 */
const pickByArtist = (candidates: NameCandidate[], wantArtist: string): string => {
  if (candidates.length === 1 || !wantArtist) return candidates[0].file;
  const exact = candidates.find((candidate) => candidate.artist === wantArtist);
  if (exact) return exact.file;
  const partial = candidates.find(
    (candidate) =>
      candidate.artist &&
      (candidate.artist.includes(wantArtist) || wantArtist.includes(candidate.artist)),
  );
  return (partial ?? candidates[0]).file;
};

/**
 * 用匹配缓存里在线模糊搜索解析出的平台 id 回查本地库
 * 本地歌首播时没有平台 id、标题也可能对不上，靠在线搜索事后写入的 id 兜底命中
 * @param track - 歌曲信息
 * @param index - 当前索引
 * @returns 命中的 TTML 原文，未命中返回 null
 */
const matchByCachedId = async (track: Track, index: RepoIndex): Promise<string | null> => {
  const fingerprint = buildFingerprint(track);
  const ncm = getMatchedId(fingerprint, "netease");
  if (ncm) {
    const hit = await tryRead(index.byNcm.get(ncm.platformId));
    if (hit) return hit;
  }
  const qq = getMatchedId(fingerprint, "qqmusic");
  if (qq) {
    for (const idCandidate of [qq.extra?.mid, qq.platformId]) {
      if (!idCandidate) continue;
      const hit = await tryRead(index.byQq.get(idCandidate));
      if (hit) return hit;
    }
  }
  return null;
};

/**
 * 在本地 TTML 歌词库中匹配当前歌曲
 * @param track - 歌曲信息
 * @returns 命中的 TTML 原文，未命中返回 null
 */
export const matchLocalTTML = async (track: Track, forceQuery = false): Promise<string | null> => {
  if (!store.get("localLyric.enableLocalTTMLOverride")) return null;
  const index = await getIndex();
  if (!index) return null;
  // track 自带平台 id 精确命中（在线歌曲）
  if (!forceQuery && track.source === "netease") {
    const hit = await tryRead(index.byNcm.get(track.id));
    if (hit) return hit;
  }
  if (!forceQuery && track.source === "qqmusic") {
    for (const idCandidate of [track.extId, track.id]) {
      if (!idCandidate) continue;
      const hit = await tryRead(index.byQq.get(idCandidate));
      if (hit) return hit;
    }
  }
  // 标题命中；同名多条时再用艺术家软性区分
  const candidates = index.byTitle.get(normalize(track.title));
  if (candidates && candidates.length > 0) {
    const preferred = pickByArtist(candidates, normalize(track.artists[0]?.name ?? ""));
    const hit = await tryRead([
      preferred,
      ...candidates
        .filter((candidate) => candidate.file !== preferred)
        .map((candidate) => candidate.file),
    ]);
    if (hit) return hit;
  }
  // 兜底：平台 id 回查
  return forceQuery ? null : matchByCachedId(track, index);
};

/**
 * 按标题与歌手词片搜索本地词库的所有候选，正文仍按需读取
 * @param keyword - 模糊搜索词
 * @param offset - 当前页起点
 * @returns 至多五十条元数据与分页状态
 */
export const searchLocalLyricVersions = async (
  keyword: string,
  offset: number,
): Promise<LyricSourceSearchPage> => {
  const index = await getIndex();
  if (!index) return { items: [], hasMore: false, total: 0 };
  const tokens = keyword.trim().split(/\s+/u).map(normalize).filter(Boolean);
  const matches = [...index.byTitle.values()]
    .flat()
    .filter((candidate) =>
      tokens.every((token) =>
        normalize((candidate.title ?? "") + (candidate.artistName ?? "")).includes(token),
      ),
    );
  const items = matches.slice(offset, offset + 50).map((candidate): LyricSearchSong => ({
    id: createHash("sha256").update(candidate.file).digest("hex"),
    title: candidate.title ?? "",
    artists: candidate.artistName ? [candidate.artistName] : [],
    duration: 0,
  }));
  return { items, total: matches.length, hasMore: offset + items.length < matches.length };
};

/**
 * 按索引生成的身份读取本地词库版本，拒绝任意路径输入
 * @param id - 搜索结果的文件身份
 * @returns 版本正文与来源元数据
 */
export const readLocalLyricVersion = async (
  id: string,
): Promise<{ content: string; song: LyricSearchSong } | null> => {
  const index = await getIndex();
  if (!index) return null;
  for (const candidates of index.byTitle.values())
    for (const candidate of candidates) {
      if (createHash("sha256").update(candidate.file).digest("hex") !== id) continue;
      const result = await readFileAutoEncoding(candidate.file);
      if (!result.trim()) return null;
      return {
        content: result,
        song: {
          id,
          title: candidate.title ?? "",
          artists: candidate.artistName ? [candidate.artistName] : [],
          duration: 0,
        },
      };
    }
  return null;
};
