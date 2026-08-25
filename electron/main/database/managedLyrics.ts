import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  LyricFormat,
  LyricInput,
  ManagedLyric,
  ManagedLyricImportResult,
  ManagedLyricOrigin,
  ManagedLyricStats,
} from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import { defaultManagedLyricsDir } from "@main/utils/paths";
import { coreLog } from "@main/utils/logger";
import { createLocalTrackId } from "@main/utils/localTrack";
import { store } from "@main/store";
import { getDb } from "./index";

const FORMAT_BY_EXTENSION: Record<string, LyricFormat> = {
  ".ttml": "ttml",
  ".lqe": "lqe",
  ".lys": "lys",
  ".yrc": "yrc",
  ".qrc": "qrc",
  ".krc": "krc",
  ".lrcn": "lrcn",
  ".lrc": "lrc",
  ".srt": "srt",
  ".ass": "ass",
};

interface ManagedRow {
  track_source: string;
  track_id: string;
  data: string;
  updated_at: number;
  filename: string | null;
  track_json: string | null;
  active_version_id: string | null;
}

interface VersionRow {
  version_id: string;
  track_source: string;
  track_id: string;
  data: string;
  filename: string;
  origin: ManagedLyricOrigin;
  imported_at: number;
}

/** 获取独立歌词目录，调用方可在文件管理器中打开。 */
export const getManagedLyricsDir = (): string => {
  const lyricDir = store.get("localLyric.managedDir") || defaultManagedLyricsDir;
  fs.mkdirSync(lyricDir, { recursive: true });
  return lyricDir;
};

/** 将路径片段转换为 Windows 文件系统可安全使用的名称。 */
const safeSegment = (value: string): string =>
  value
    .split("")
    .map((char) => (char.charCodeAt(0) <= 31 ? "_" : char))
    .join("")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/[. ]+$/g, "_") || "unknown";

/**
 * 常规数字/小写 ID 保持可读；可能因非法字符或 Windows 大小写规则碰撞的 ID
 * 追加原值哈希，确保不同曲目不会共享同一个目录。
 */
const trackDirectoryName = (value: string): string => {
  const safe = safeSegment(value);
  if (safe === value && value === value.toLowerCase()) return safe;
  const suffix = createHash("sha256").update(value).digest("hex").slice(0, 10);
  return `${safe}--${suffix}`;
};

/** 获取歌曲 ID 对应的歌词目录。 */
const trackLyricsDir = (track: Pick<Track, "source" | "id">): string =>
  path.join(getManagedLyricsDir(), safeSegment(track.source), trackDirectoryName(String(track.id)));

/**
 * 获取歌曲的手动歌词目录，并确保目录存在。
 * @param track - 歌曲来源与 ID
 * @returns 歌曲对应的歌词目录
 */
export const getManagedTrackLyricsDir = (track: Pick<Track, "source" | "id">): string => {
  const directory = trackLyricsDir(track);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
};

/** 归一化歌词文件名并保留用户可识别的原始名称。 */
const normalizeFilename = (
  filename: string | null,
  format: LyricFormat,
  origin: ManagedLyricOrigin,
): string => {
  const fallback = `${origin}.${format}`;
  const base = safeSegment(path.basename(filename?.trim() || fallback));
  return path.extname(base) ? base : `${base}.${format}`;
};

/** 为歌曲内的歌词文件生成稳定版本 ID。 */
const createVersionId = (track: Pick<Track, "source" | "id">, filename: string): string =>
  createHash("sha256")
    .update(`${track.source}\0${track.id}\0${filename.toLowerCase()}`)
    .digest("hex")
    .slice(0, 20);

/** 为迁移时发生冲突的歌词文件生成不覆盖现有文件的名称。 */
const migratedFilename = (filename: string, versionId: string, used: Set<string>): string => {
  const extension = path.extname(filename);
  const stem = path.basename(filename, extension);
  const suffix = versionId.slice(0, 8);
  let candidate = `${stem}-migrated-${suffix}${extension}`;
  let index = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${stem}-migrated-${suffix}-${index}${extension}`;
    index++;
  }
  return candidate;
};

/** 只保留可持久化的歌词载荷字段。 */
const storedLyric = (
  lyric: LyricInput & { format: LyricFormat },
): LyricInput & { format: LyricFormat } => ({
  content: lyric.content,
  format: lyric.format,
  translation: lyric.translation,
  translationFormat: lyric.translationFormat,
  romaji: lyric.romaji,
  romajiFormat: lyric.romajiFormat,
});

/** 读取歌曲的活跃数据库记录。 */
const getManagedRow = (track: Pick<Track, "source" | "id">): ManagedRow | undefined =>
  getDb()
    .prepare(
      `SELECT track_source, track_id, data, updated_at, filename, track_json, active_version_id
       FROM managed_lyrics WHERE track_source = ? AND track_id = ?`,
    )
    .get(track.source, track.id) as ManagedRow | undefined;

/** 将旧版扁平文件记录按需迁移到歌曲 ID 目录。 */
const ensureActiveVersion = (row: ManagedRow): VersionRow | null => {
  if (row.active_version_id) {
    const existing = getDb()
      .prepare(
        `SELECT version_id, track_source, track_id, data, filename, origin, imported_at
         FROM managed_lyric_versions WHERE version_id = ?`,
      )
      .get(row.active_version_id) as VersionRow | undefined;
    if (existing) return existing;
  }

  try {
    const lyric = JSON.parse(row.data) as LyricInput & { format: LyricFormat };
    const track = { source: row.track_source as Track["source"], id: row.track_id };
    const filename = normalizeFilename(row.filename, lyric.format, "manual");
    const versionId = createVersionId(track, filename);
    const directory = trackLyricsDir(track);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, filename), lyric.content, "utf8");
    getDb()
      .prepare(
        `INSERT INTO managed_lyric_versions
          (version_id, track_source, track_id, data, filename, origin, imported_at)
         VALUES (?, ?, ?, ?, ?, 'manual', ?)
         ON CONFLICT(track_source, track_id, filename) DO UPDATE SET
           data = excluded.data, imported_at = excluded.imported_at`,
      )
      .run(versionId, row.track_source, row.track_id, row.data, filename, row.updated_at);
    getDb()
      .prepare(
        "UPDATE managed_lyrics SET active_version_id = ?, filename = ? WHERE track_source = ? AND track_id = ?",
      )
      .run(versionId, filename, row.track_source, row.track_id);

    const legacySafe = `${row.track_source}_${row.track_id}`.replace(/[^a-zA-Z0-9._-]/g, "_");
    const legacyPath = path.join(getManagedLyricsDir(), `${legacySafe}.${lyric.format}`);
    if (fs.existsSync(legacyPath)) fs.rmSync(legacyPath, { force: true });
    return {
      version_id: versionId,
      track_source: row.track_source,
      track_id: row.track_id,
      data: row.data,
      filename,
      origin: "manual",
      imported_at: row.updated_at,
    };
  } catch (error) {
    coreLog.error(`[lyrics] 升级旧版手动歌词记录失败: ${row.track_source}:${row.track_id}`, error);
    return null;
  }
};

/**
 * 将曾以完整文件路径作为 ID 的本地手动歌词合并到标准 16 位路径哈希 ID。
 * 文件先复制，数据库事务成功后才删除旧目录；重复执行不会覆盖现有歌词。
 */
export const migrateLegacyLocalManagedLyrics = (): void => {
  const legacyRows = getDb()
    .prepare(
      `SELECT track_source, track_id, data, updated_at, filename, track_json, active_version_id
       FROM managed_lyrics WHERE track_source = 'local' AND track_json IS NOT NULL`,
    )
    .all() as ManagedRow[];

  for (const legacy of legacyRows) {
    try {
      const legacyTrack = JSON.parse(legacy.track_json ?? "") as Track;
      if (!legacyTrack.path) continue;
      const canonicalId = createLocalTrackId(legacyTrack.path);
      if (legacy.track_id === canonicalId) continue;

      const canonicalTrack = { ...legacyTrack, source: "local" as const, id: canonicalId };
      const legacyActiveId = ensureActiveVersion(legacy)?.version_id ?? null;
      const legacyVersions = getDb()
        .prepare(
          `SELECT version_id, track_source, track_id, data, filename, origin, imported_at
         FROM managed_lyric_versions WHERE track_source = 'local' AND track_id = ?
         ORDER BY imported_at ASC`,
        )
        .all(legacy.track_id) as VersionRow[];
      if (legacyVersions.length === 0) continue;

      const canonicalRow = getManagedRow(canonicalTrack);
      if (canonicalRow) ensureActiveVersion(canonicalRow);
      const canonicalVersions = getDb()
        .prepare(
          `SELECT version_id, track_source, track_id, data, filename, origin, imported_at
         FROM managed_lyric_versions WHERE track_source = 'local' AND track_id = ?`,
        )
        .all(canonicalId) as VersionRow[];
      const byFilename = new Map(
        canonicalVersions.map((version) => [version.filename.toLowerCase(), version]),
      );
      const usedFilenames = new Set(byFilename.keys());
      const versionIdMap = new Map<string, string>();
      const migratedVersions: VersionRow[] = [];
      const sourceDirectory = trackLyricsDir({ source: "local", id: legacy.track_id });
      const targetDirectory = trackLyricsDir(canonicalTrack);
      fs.mkdirSync(targetDirectory, { recursive: true });

      for (const version of legacyVersions) {
        const conflict = byFilename.get(version.filename.toLowerCase());
        if (conflict?.data === version.data) {
          versionIdMap.set(version.version_id, conflict.version_id);
          continue;
        }
        const filename = conflict
          ? migratedFilename(version.filename, version.version_id, usedFilenames)
          : version.filename;
        usedFilenames.add(filename.toLowerCase());
        const versionId = createVersionId(canonicalTrack, filename);
        const sourceFile = path.join(sourceDirectory, version.filename);
        const targetFile = path.join(targetDirectory, filename);
        if (!fs.existsSync(targetFile)) {
          if (fs.existsSync(sourceFile)) fs.copyFileSync(sourceFile, targetFile);
          else {
            const lyric = JSON.parse(version.data) as LyricInput & { format: LyricFormat };
            fs.writeFileSync(targetFile, lyric.content, "utf8");
          }
        }
        const migrated = {
          ...version,
          version_id: versionId,
          track_id: canonicalId,
          filename,
        };
        migratedVersions.push(migrated);
        byFilename.set(filename.toLowerCase(), migrated);
        versionIdMap.set(version.version_id, versionId);
      }

      getDb().transaction(() => {
        for (const version of migratedVersions) {
          getDb()
            .prepare(
              `INSERT OR IGNORE INTO managed_lyric_versions
              (version_id, track_source, track_id, data, filename, origin, imported_at)
             VALUES (?, 'local', ?, ?, ?, ?, ?)`,
            )
            .run(
              version.version_id,
              canonicalId,
              version.data,
              version.filename,
              version.origin,
              version.imported_at,
            );
        }

        const existingTarget = getManagedRow(canonicalTrack);
        if (existingTarget) {
          getDb()
            .prepare(
              "UPDATE managed_lyrics SET track_json = ? WHERE track_source = 'local' AND track_id = ?",
            )
            .run(JSON.stringify(canonicalTrack), canonicalId);
        } else {
          const activeId =
            (legacyActiveId ? versionIdMap.get(legacyActiveId) : undefined) ??
            migratedVersions[0]?.version_id;
          const active = activeId
            ? (getDb()
                .prepare(
                  `SELECT version_id, track_source, track_id, data, filename, origin, imported_at
                 FROM managed_lyric_versions WHERE version_id = ?`,
                )
                .get(activeId) as VersionRow | undefined)
            : undefined;
          if (active) {
            getDb()
              .prepare(
                `INSERT INTO managed_lyrics
                (track_source, track_id, data, filename, track_json, active_version_id, updated_at)
               VALUES ('local', ?, ?, ?, ?, ?, ?)`,
              )
              .run(
                canonicalId,
                active.data,
                active.filename,
                JSON.stringify(canonicalTrack),
                active.version_id,
                legacy.updated_at,
              );
          }
        }

        const canonicalPreference = getDb()
          .prepare(
            "SELECT choice_json FROM track_lyric_preferences WHERE track_source = 'local' AND track_id = ?",
          )
          .get(canonicalId) as { choice_json: string } | undefined;
        const legacyPreference = getDb()
          .prepare(
            "SELECT choice_json, updated_at FROM track_lyric_preferences WHERE track_source = 'local' AND track_id = ?",
          )
          .get(legacy.track_id) as { choice_json: string; updated_at: number } | undefined;
        if (!canonicalPreference && legacyPreference) {
          const choice = JSON.parse(legacyPreference.choice_json) as {
            source: string;
            versionId?: string;
          };
          if (choice.source === "local" && choice.versionId) {
            choice.versionId = versionIdMap.get(choice.versionId) ?? choice.versionId;
          }
          getDb()
            .prepare(
              `INSERT INTO track_lyric_preferences
              (track_source, track_id, choice_json, updated_at) VALUES ('local', ?, ?, ?)`,
            )
            .run(canonicalId, JSON.stringify(choice), legacyPreference.updated_at);
        }
        getDb()
          .prepare(
            "DELETE FROM track_lyric_preferences WHERE track_source = 'local' AND track_id = ?",
          )
          .run(legacy.track_id);
        getDb()
          .prepare(
            "DELETE FROM managed_lyric_versions WHERE track_source = 'local' AND track_id = ?",
          )
          .run(legacy.track_id);
        getDb()
          .prepare("DELETE FROM managed_lyrics WHERE track_source = 'local' AND track_id = ?")
          .run(legacy.track_id);
      })();

      fs.rmSync(sourceDirectory, { recursive: true, force: true });
      coreLog.info(`[lyrics] 已统一本地手动歌词 ID: ${legacy.track_id} -> ${canonicalId}`);
    } catch (error) {
      coreLog.error(`[lyrics] 统一本地手动歌词 ID 失败: ${legacy.track_id}`, error);
    }
  }
};

/** 读取歌曲当前活跃的手动歌词。 */
export const getManagedLyric = (track: Pick<Track, "source" | "id">): ManagedLyric | null => {
  const row = getManagedRow(track);
  if (!row) return null;
  const version = ensureActiveVersion(row);
  if (!version) return null;
  try {
    return {
      ...(JSON.parse(row.data) as LyricInput & { format: LyricFormat }),
      importedAt: row.updated_at,
      filename: version.filename,
      filePath: path.join(trackLyricsDir(track), version.filename),
      versionId: version.version_id,
      origin: version.origin,
      track: row.track_json ? (JSON.parse(row.track_json) as Track) : undefined,
    };
  } catch (error) {
    coreLog.error(`[lyrics] 读取手动歌词记录失败: ${track.source}:${track.id}`, error);
    return null;
  }
};

/** 提取主 LRCN 中可供 LNT 精确关联的行 ID。 */
const lrcnLineIds = (content: string): Set<string> => {
  const ids = new Set<string>();
  for (const raw of content.split(/\r?\n/)) {
    const match = /^\[([^\]]+)\]/.exec(raw.trim());
    if (!match) continue;
    const parts = match[1].split(",").map((part) => part.trim());
    const id = parts.length >= 4 ? parts[3] : "";
    if (id && id !== "x-bg" && !/^\d+$/.test(id)) ids.add(id);
  }
  return ids;
};

/** 提取外置 LNT 的主行 ID；背景行需依附在已匹配的主行之后。 */
const lntLineIds = (content: string): Set<string> => {
  const ids = new Set<string>();
  for (const raw of content.split(/\r?\n/)) {
    const match = /^\[([^\]]+)\]/.exec(raw.trim());
    if (!match || /^(?:translate|transliteration|lang):/i.test(match[1])) continue;
    const parts = match[1].split(",").map((part) => part.trim());
    const id = parts.length >= 2 ? parts[1] : parts[0];
    if (id && id !== "x-bg" && !/^\d+$/.test(id) && !/^\d+(?::\d+){0,2}(?:\.\d+)?$/.test(id)) {
      ids.add(id);
    }
  }
  return ids;
};

/** 将外置 LNT 作为翻译或逐字发音附加到当前活跃 LRCN，而不是覆盖主歌词。 */
export const attachManagedLnt = (
  track: Pick<Track, "source" | "id"> & Partial<Track>,
  content: string,
  kind: "translation" | "romaji",
): boolean => {
  const current = getManagedLyric(track);
  if (!current || current.format !== "lrcn") return false;
  const mainIds = lrcnLineIds(current.content);
  const attachmentIds = lntLineIds(content);
  if (mainIds.size === 0 || ![...attachmentIds].some((id) => mainIds.has(id))) return false;
  setManagedLyric(
    track,
    {
      content: current.content,
      format: current.format,
      translation: kind === "translation" ? content : current.translation,
      translationFormat: kind === "translation" ? "lnt" : current.translationFormat,
      romaji: kind === "romaji" ? content : current.romaji,
      romajiFormat: kind === "romaji" ? "lnt" : current.romajiFormat,
    },
    current.filename ?? `managed.${current.format}`,
    current.origin,
  );
  return true;
};

/** 写入歌词版本，并按调用方语义决定是否设为当前活跃版本。 */
export const setManagedLyric = (
  track: Pick<Track, "source" | "id"> & Partial<Track>,
  lyric: LyricInput & { format: LyricFormat },
  filename: string | null,
  origin: ManagedLyricOrigin = "manual",
  activate = true,
): void => {
  const payload = storedLyric(lyric);
  const normalizedFilename = normalizeFilename(filename, lyric.format, origin);
  const versionId = createVersionId(track, normalizedFilename);
  const importedAt = Date.now();
  const directory = trackLyricsDir(track);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, normalizedFilename), lyric.content, "utf8");
  const data = JSON.stringify(payload);
  getDb().transaction(() => {
    getDb()
      .prepare(
        `INSERT INTO managed_lyric_versions
          (version_id, track_source, track_id, data, filename, origin, imported_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(track_source, track_id, filename) DO UPDATE SET
           data = excluded.data, origin = excluded.origin, imported_at = excluded.imported_at`,
      )
      .run(versionId, track.source, track.id, data, normalizedFilename, origin, importedAt);
    if (activate) {
      getDb()
        .prepare(
          `INSERT INTO managed_lyrics
            (track_source, track_id, data, filename, track_json, active_version_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(track_source, track_id) DO UPDATE SET
             data = excluded.data, filename = excluded.filename,
             track_json = COALESCE(excluded.track_json, managed_lyrics.track_json),
             active_version_id = excluded.active_version_id, updated_at = excluded.updated_at`,
        )
        .run(
          track.source,
          track.id,
          data,
          normalizedFilename,
          "title" in track ? JSON.stringify(track) : null,
          versionId,
          importedAt,
        );
    } else if ("title" in track) {
      getDb()
        .prepare(
          `UPDATE managed_lyrics SET track_json = ?
           WHERE track_source = ? AND track_id = ?`,
        )
        .run(JSON.stringify(track), track.source, track.id);
    }
  })();
};

/**
 * 只更新手动歌词记录中的曲目元数据，不触碰歌词文件和版本时间。
 * @param track - 包含最新元数据的歌曲
 */
export const updateManagedLyricTrack = (track: Track): void => {
  getDb()
    .prepare(
      `UPDATE managed_lyrics SET track_json = ?
       WHERE track_source = ? AND track_id = ?`,
    )
    .run(JSON.stringify(track), track.source, track.id);
};

/**
 * 导入一个本地歌词文件；已有活跃版本时，新文件只加入候选列表。
 * @param track - 目标歌曲
 * @param lyric - 解析后的歌词载荷
 * @param filename - 用户选择的原文件名
 * @param overwrite - 是否确认覆盖同名版本
 * @returns 导入、覆盖或同名冲突结果
 */
export const importManagedLyric = (
  track: Pick<Track, "source" | "id"> & Partial<Track>,
  lyric: LyricInput & { format: LyricFormat },
  filename: string,
  overwrite = false,
): ManagedLyricImportResult => {
  const normalized = normalizeFilename(filename, lyric.format, "manual");
  const existing = getDb()
    .prepare(
      `SELECT version_id, track_source, track_id, data, filename, origin, imported_at
       FROM managed_lyric_versions
       WHERE track_source = ? AND track_id = ? AND filename = ?`,
    )
    .get(track.source, track.id, normalized) as VersionRow | undefined;
  if (existing && !overwrite) {
    return { status: "conflict", versionId: existing.version_id, filename: existing.filename };
  }
  const active = getManagedRow(track);
  const canonicalFilename = existing?.filename ?? normalized;
  const versionId = existing?.version_id ?? createVersionId(track, canonicalFilename);
  const affectsActive = !active?.active_version_id || active.active_version_id === versionId;
  setManagedLyric(track, lyric, canonicalFilename, "manual", affectsActive);
  return {
    status: existing ? "overwritten" : "imported",
    versionId,
    activeChanged: affectsActive,
  };
};

/**
 * 以歌曲歌词目录为准同步本地歌词版本。
 * @param track - 目标歌曲
 */
export const refreshManagedLyricVersions = (
  track: Pick<Track, "source" | "id"> & Partial<Track>,
): boolean => {
  const active = getManagedRow(track);
  if (active) ensureActiveVersion(active);
  const directory = getManagedTrackLyricsDir(track);
  let entries: fs.Dirent[];
  try {
    entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .filter(
        (entry) => entry.isFile() && !!FORMAT_BY_EXTENSION[path.extname(entry.name).toLowerCase()],
      )
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    coreLog.error(`[lyrics] 扫描歌曲歌词目录失败: ${track.source}:${track.id}`, error);
    return false;
  }
  const diskNames = new Set(entries.map((entry) => entry.name.toLowerCase()));
  const files: Array<{
    filename: string;
    format: LyricFormat;
    content: string;
    modifiedAt: number;
  }> = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    try {
      files.push({
        filename: entry.name,
        format: FORMAT_BY_EXTENSION[path.extname(entry.name).toLowerCase()],
        content: fs.readFileSync(filePath, "utf8"),
        modifiedAt: Math.round(fs.statSync(filePath).mtimeMs),
      });
    } catch (error) {
      coreLog.warn(
        `[lyrics] 读取歌曲歌词文件失败，保留原数据库记录: ${track.source}:${track.id}/${entry.name}`,
        error,
      );
    }
  }
  const rows = getDb()
    .prepare(
      `SELECT version_id, track_source, track_id, data, filename, origin, imported_at
       FROM managed_lyric_versions WHERE track_source = ? AND track_id = ?`,
    )
    .all(track.source, track.id) as VersionRow[];
  const activeId = getManagedRow(track)?.active_version_id;
  let changed = false;

  getDb().transaction(() => {
    for (const row of rows) {
      if (!diskNames.has(row.filename.toLowerCase())) {
        getDb()
          .prepare("DELETE FROM managed_lyric_versions WHERE version_id = ?")
          .run(row.version_id);
        changed = true;
      }
    }

    for (const file of files) {
      const existing = rows.find(
        (row) => row.filename.toLowerCase() === file.filename.toLowerCase(),
      );
      let previous: (LyricInput & { format: LyricFormat }) | undefined;
      if (existing) {
        try {
          previous = JSON.parse(existing.data) as LyricInput & { format: LyricFormat };
        } catch (error) {
          coreLog.warn(
            `[lyrics] 歌词版本数据损坏，将从文件重建: ${track.source}:${track.id}/${existing.filename}`,
            error,
          );
        }
      }
      const data = JSON.stringify(
        storedLyric({
          ...previous,
          content: file.content,
          format: file.format,
        }),
      );
      const versionId = existing?.version_id ?? createVersionId(track, file.filename);
      if (!existing || existing.data !== data || existing.imported_at !== file.modifiedAt) {
        changed = true;
      }
      getDb()
        .prepare(
          `INSERT INTO managed_lyric_versions
            (version_id, track_source, track_id, data, filename, origin, imported_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(track_source, track_id, filename) DO UPDATE SET
             data = excluded.data, imported_at = excluded.imported_at`,
        )
        .run(
          versionId,
          track.source,
          track.id,
          data,
          existing?.filename ?? file.filename,
          existing?.origin ?? "manual",
          file.modifiedAt,
        );
    }

    const versions = getDb()
      .prepare(
        `SELECT version_id, track_source, track_id, data, filename, origin, imported_at
         FROM managed_lyric_versions
         WHERE track_source = ? AND track_id = ?
         ORDER BY imported_at DESC, filename COLLATE NOCASE ASC`,
      )
      .all(track.source, track.id) as VersionRow[];
    const selected = versions.find((version) => version.version_id === activeId) ?? versions[0];
    if (!selected) {
      if (getManagedRow(track)) changed = true;
      getDb()
        .prepare("DELETE FROM managed_lyrics WHERE track_source = ? AND track_id = ?")
        .run(track.source, track.id);
      return;
    }
    const current = getManagedRow(track);
    if (
      !current ||
      current.active_version_id !== selected.version_id ||
      current.data !== selected.data ||
      current.filename !== selected.filename
    ) {
      changed = true;
    }
    getDb()
      .prepare(
        `INSERT INTO managed_lyrics
          (track_source, track_id, data, filename, track_json, active_version_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(track_source, track_id) DO UPDATE SET
           data = excluded.data, filename = excluded.filename,
           track_json = COALESCE(excluded.track_json, managed_lyrics.track_json),
           active_version_id = excluded.active_version_id, updated_at = excluded.updated_at`,
      )
      .run(
        track.source,
        track.id,
        selected.data,
        selected.filename,
        "title" in track ? JSON.stringify(track) : null,
        selected.version_id,
        selected.imported_at,
      );
  })();
  coreLog.info(
    `[lyrics] 已刷新歌曲歌词目录: ${track.source}:${track.id}, 文件=${entries.length}, 可读取=${files.length}, 原记录=${rows.length}, 变更=${changed}`,
  );
  return changed;
};

/** 列出歌曲目录中的全部本地歌词版本。 */
export const listManagedLyricVersions = (track: Pick<Track, "source" | "id">): ManagedLyric[] => {
  const active = getManagedRow(track);
  if (active) ensureActiveVersion(active);
  const activeId = getManagedRow(track)?.active_version_id;
  const rows = getDb()
    .prepare(
      `SELECT version_id, track_source, track_id, data, filename, origin, imported_at
       FROM managed_lyric_versions
       WHERE track_source = ? AND track_id = ? ORDER BY imported_at DESC`,
    )
    .all(track.source, track.id) as VersionRow[];
  return rows.flatMap((row) => {
    try {
      const lyric = JSON.parse(row.data) as LyricInput & { format: LyricFormat };
      const filePath = path.join(trackLyricsDir(track), row.filename);
      return [
        {
          ...lyric,
          importedAt: row.imported_at,
          filename: row.filename,
          filePath,
          versionId: row.version_id,
          origin: row.origin,
          track: active?.track_json ? (JSON.parse(active.track_json) as Track) : undefined,
          active: row.version_id === activeId,
        } as ManagedLyric & { active: boolean },
      ];
    } catch {
      return [];
    }
  });
};

/** 将现有本地歌词版本设为活跃版本。 */
export const activateManagedLyricVersion = (
  track: Pick<Track, "source" | "id">,
  versionId: string,
): boolean => {
  const version = getDb()
    .prepare(
      `SELECT version_id, track_source, track_id, data, filename, origin, imported_at
       FROM managed_lyric_versions
       WHERE version_id = ? AND track_source = ? AND track_id = ?`,
    )
    .get(versionId, track.source, track.id) as VersionRow | undefined;
  if (!version) return false;
  getDb()
    .prepare(
      `UPDATE managed_lyrics SET data = ?, filename = ?, active_version_id = ?, updated_at = ?
       WHERE track_source = ? AND track_id = ?`,
    )
    .run(version.data, version.filename, version.version_id, Date.now(), track.source, track.id);
  return true;
};

/** 删除一个本地歌词版本；活跃版本被删除时自动切换到其余最新版本。 */
export const deleteManagedLyricVersion = (
  track: Pick<Track, "source" | "id">,
  versionId: string,
): boolean => {
  const active = getManagedRow(track);
  if (!active) return false;
  const version = getDb()
    .prepare(
      `SELECT version_id, track_source, track_id, data, filename, origin, imported_at
       FROM managed_lyric_versions
       WHERE version_id = ? AND track_source = ? AND track_id = ?`,
    )
    .get(versionId, track.source, track.id) as VersionRow | undefined;
  if (!version) return false;
  const replacement =
    active.active_version_id === versionId
      ? (getDb()
          .prepare(
            `SELECT version_id, track_source, track_id, data, filename, origin, imported_at
             FROM managed_lyric_versions
             WHERE track_source = ? AND track_id = ? AND version_id != ?
             ORDER BY imported_at DESC LIMIT 1`,
          )
          .get(track.source, track.id, versionId) as VersionRow | undefined)
      : undefined;
  const directory = trackLyricsDir(track);
  fs.rmSync(path.join(directory, version.filename), { force: true });
  getDb().transaction(() => {
    getDb().prepare("DELETE FROM managed_lyric_versions WHERE version_id = ?").run(versionId);
    if (active.active_version_id !== versionId) return;
    if (replacement) {
      getDb()
        .prepare(
          `UPDATE managed_lyrics SET data = ?, filename = ?, active_version_id = ?, updated_at = ?
           WHERE track_source = ? AND track_id = ?`,
        )
        .run(
          replacement.data,
          replacement.filename,
          replacement.version_id,
          Date.now(),
          track.source,
          track.id,
        );
    } else {
      getDb()
        .prepare("DELETE FROM managed_lyrics WHERE track_source = ? AND track_id = ?")
        .run(track.source, track.id);
    }
  })();
  try {
    if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) {
      fs.rmSync(directory, { force: true });
    }
  } catch {
    // 空目录清理失败不影响版本删除的一致性。
  }
  return true;
};

/** 删除歌曲的全部手动歌词。 */
export const deleteManagedLyric = (track: Pick<Track, "source" | "id">): void => {
  fs.rmSync(trackLyricsDir(track), { recursive: true, force: true });
  getDb().transaction(() => {
    getDb()
      .prepare("DELETE FROM managed_lyric_versions WHERE track_source = ? AND track_id = ?")
      .run(track.source, track.id);
    getDb()
      .prepare("DELETE FROM managed_lyrics WHERE track_source = ? AND track_id = ?")
      .run(track.source, track.id);
  })();
};

/** 清空所有手动管理歌词及其独立原文副本。 */
export const clearManagedLyrics = (): void => {
  fs.rmSync(getManagedLyricsDir(), { recursive: true, force: true });
  getDb().transaction(() => {
    getDb().prepare("DELETE FROM managed_lyric_versions").run();
    getDb().prepare("DELETE FROM managed_lyrics").run();
  })();
};

/**
 * 将手动导入歌词迁移到新目录；复制和配置落盘成功后才清理旧目录。
 * @param directory - 新的手动歌词目录
 * @returns 新目录的文件统计
 */
export const moveManagedLyricsDir = async (directory: string): Promise<ManagedLyricStats> => {
  const source = getManagedLyricsDir();
  const target = path.resolve(directory);
  if (path.resolve(source) === target) return getManagedLyricStats();
  const relative = path.relative(source, target);
  const reverseRelative = path.relative(target, source);
  if (
    (!relative.startsWith("..") && !path.isAbsolute(relative)) ||
    (!reverseRelative.startsWith("..") && !path.isAbsolute(reverseRelative))
  ) {
    throw new Error("手动导入歌词目录不能迁移到其自身或父子目录");
  }
  coreLog.info(`[lyrics] 开始迁移手动歌词目录: ${source} -> ${target}`);
  let stats: ManagedLyricStats;
  try {
    await fs.promises.mkdir(target, { recursive: true });
    await fs.promises.cp(source, target, {
      recursive: true,
      force: true,
      errorOnExist: false,
    });
    store.set("localLyric.managedDir", target);
    store.flushImmediate();
    stats = getManagedLyricStats();
  } catch (error) {
    try {
      store.set("localLyric.managedDir", source === defaultManagedLyricsDir ? "" : source);
      store.flushImmediate();
    } catch (rollbackError) {
      coreLog.error(`[lyrics] 恢复原手动歌词目录配置失败: ${source}`, rollbackError);
    }
    coreLog.error(`[lyrics] 迁移手动歌词目录失败: ${source} -> ${target}`, error);
    throw error;
  }
  try {
    await fs.promises.rm(source, { recursive: true, force: true });
  } catch (error) {
    coreLog.warn(`[lyrics] 新目录已生效，但旧手动歌词目录清理失败: ${source}`, error);
  }
  coreLog.info(`[lyrics] 手动歌词目录迁移完成: ${target}, ${stats.count} 个文件`);
  return stats;
};

/** 获取手动管理歌词目录的文件数量与占用空间。 */
export const getManagedLyricStats = (): ManagedLyricStats => {
  const lyricDir = getManagedLyricsDir();
  let size = 0;
  let count = 0;
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile()) {
        size += fs.statSync(entryPath).size;
        count++;
      }
    }
  };
  visit(lyricDir);
  return { path: lyricDir, size, count };
};

/** 列出每首歌曲当前活跃的手动歌词，供全局管理器浏览。 */
export const listManagedLyrics = (): Array<
  ManagedLyric & { trackSource: string; trackId: string }
> => {
  const rows = getDb()
    .prepare("SELECT track_source, track_id FROM managed_lyrics ORDER BY updated_at DESC")
    .all() as Array<{ track_source: string; track_id: string }>;
  return rows.flatMap((row) => {
    const lyric = getManagedLyric({
      source: row.track_source as Track["source"],
      id: row.track_id,
    });
    return lyric ? [{ ...lyric, trackSource: row.track_source, trackId: row.track_id }] : [];
  });
};
