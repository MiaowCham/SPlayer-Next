import fs from "node:fs";
import { parseStreamingSource } from "@shared/utils/streamingSource";
import { resolveStreamingMediaSource } from "@main/services/streaming/mediaSource";
import fsp, { type FileHandle } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { app } from "electron";
import { store } from "@main/store";
import { getSongCacheDir } from "@main/utils/config";
import { songCacheLog } from "@main/utils/logger";
import type { TrackSource } from "@shared/types/player";
import {
  clearAll as dbClearAll,
  deleteByKey,
  findByFilename,
  findByKey,
  listAllFilenames,
  listLruVictims,
  totalSize,
  touchLastUsed,
  upsert,
} from "@main/database/songCache";

/** 下载并发上限 */
const MAX_CONCURRENT = 2;
/** 一批 LRU 淘汰数 */
const EVICT_BATCH = 8;

/**
 * 拒绝的响应 Content-Type 前缀（命中即不入缓存）
 * 第三方代理常用 200 包一段 HTML/JSON 错误体冒充音频，这里第一道拦截
 */
const REJECTED_MIME_PREFIXES = ["text/html", "application/json", "application/xml", "text/xml"];

const isRejectedMime = (mime: string | null): boolean => {
  if (!mime) return false;
  const lower = mime.toLowerCase();
  return REJECTED_MIME_PREFIXES.some((prefix) => lower.startsWith(prefix));
};

/**
 * 文件头是否像音频
 *
 * 反向看首字节，挡 HTML/JSON 错误页冒充音频的常见骗局
 * 不做正向 magic 枚举（容器太多枚举不全反而漏判），剩余漏网坏文件由 player.ts:228
 * 的解码失败 invalidate 兜底
 */
const looksLikeAudio = async (filePath: string): Promise<boolean> => {
  let fd: FileHandle | null = null;
  try {
    fd = await fsp.open(filePath, "r");
    const buf = Buffer.alloc(4);
    const { bytesRead } = await fd.read(buf, 0, 4, 0);
    if (bytesRead === 0) return false;
    // '<' = HTML/XML，'{' = JSON 对象，'[' = JSON 数组
    return buf[0] !== 0x3c && buf[0] !== 0x7b && buf[0] !== 0x5b;
  } catch {
    return false;
  } finally {
    if (fd) await fd.close().catch(() => {});
  }
};

interface InFlight {
  promise: Promise<string | null>;
  controller: AbortController;
  owners: Set<string>;
}

/** 当前生效的歌曲缓存目录 */
let cacheDir = getSongCacheDir();
/** 进行中的下载，按 cacheKey 去重 */
const inFlight = new Map<string, InFlight>();
/** 等待槽位的队列；只存 starter，槽位空出来时取队头执行 */
const waiting: Array<() => void> = [];
let activeDownloads = 0;
let preloadPin: { id: string; filename: string } | null = null;
/** 已接收但尚未转入数据库统计的字节，包含写入队列和清理失败的临时文件 */
let reservedBytes = 0;
let budgetQueue: Promise<unknown> = Promise.resolve();

/**
 * 串行执行容量预留、淘汰和入库，避免并发下载重复使用同一份余量
 * @param task - 需要独占容量统计的操作
 * @returns 操作结果
 */
const withBudget = <T>(task: () => Promise<T>): Promise<T> => {
  const result = budgetQueue.then(task);
  budgetQueue = result.catch(() => {});
  return result;
};

/** sizeLimit 字节数；0/负数视为不限制 */
const sizeLimitBytes = (): number => {
  const gb = store.get("cache.songCache.sizeLimitGb") ?? 10;
  return gb > 0 ? gb * 1024 * 1024 * 1024 : Number.POSITIVE_INFINITY;
};

/** 是否启用歌曲缓存 */
const isCacheEnabled = (): boolean => store.get("cache.songCache.enabled") === true;

/**
 * 用 cache_key 派生唯一文件名
 * @param cacheKey - 缓存键
 * @returns 文件名
 */
const filenameFor = (cacheKey: string): string => {
  const hash = crypto.createHash("sha1").update(cacheKey).digest("hex").slice(0, 16);
  return `${hash}.bin`;
};

/** 获取文件的绝对路径
 * @param filename - 文件名
 * @returns 绝对路径
 */
const absPath = (filename: string): string => path.join(cacheDir, filename);

/**
 * 等待可用下载槽位，排队期间支持取消
 * @param signal - 下载任务的取消信号
 * @returns 成功取得槽位时返回 true，取得槽位前被取消时返回 false
 */
const acquireSlot = async (signal: AbortSignal): Promise<boolean> => {
  if (signal.aborted) return false;
  if (activeDownloads < MAX_CONCURRENT) {
    activeDownloads++;
    return true;
  }
  return new Promise((resolve) => {
    const start = (): void => {
      signal.removeEventListener("abort", abort);
      resolve(true);
    };
    const abort = (): void => {
      const index = waiting.indexOf(start);
      if (index >= 0) waiting.splice(index, 1);
      resolve(false);
    };
    waiting.push(start);
    signal.addEventListener("abort", abort, { once: true });
  });
};

/** 将下载槽位交给下一个等待者，没有等待者时减少活跃下载数 */
const releaseSlot = (): void => {
  const next = waiting.shift();
  if (next) next();
  else activeDownloads--;
};

/**
 * 为备用槽位保留缓存文件，防止切歌前被 LRU 淘汰
 * @param id - 持有缓存租约的预载任务标识
 * @param sourcePath - 预载音源路径，仅缓存目录内的文件会被保留
 */
export const pinPreload = (id: string, sourcePath: string): void => {
  if (path.dirname(sourcePath) === cacheDir)
    preloadPin = { id, filename: path.basename(sourcePath) };
};

/**
 * 释放预载租约，仅在没有其他消费者时中止共用下载
 * @param id - 要取消的预载任务标识
 */
export const cancelPreload = (id: string): void => {
  if (preloadPin?.id === id) preloadPin = null;
  for (const pending of inFlight.values()) {
    if (pending.owners.delete(id) && pending.owners.size === 0) pending.controller.abort();
  }
};

/**
 * 启动时清理孤儿，无法删除的文件仍计入容量
 */
const cleanupOrphans = async (): Promise<void> => {
  let entries: string[];
  try {
    entries = await fsp.readdir(cacheDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      reservedBytes = Number.POSITIVE_INFINITY;
      songCacheLog.warn("[init] 无法核对缓存目录占用，暂停有限容量缓存", error);
    }
    return;
  }

  let partRemoved = 0;
  let orphanFiles = 0;
  const known = new Set(listAllFilenames());
  for (const name of entries) {
    if (!name.endsWith(".part") && known.has(name)) continue;
    const full = path.join(cacheDir, name);
    try {
      await fsp.unlink(full);
      if (name.endsWith(".part")) partRemoved++;
      else orphanFiles++;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      try {
        reservedBytes += (await fsp.stat(full)).size;
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== "ENOENT") {
          reservedBytes = Number.POSITIVE_INFINITY;
        }
      }
      songCacheLog.warn(`[init] 保留未删除文件的容量统计：${full}`, error);
    }
  }

  let missingRows = 0;
  for (const filename of known) {
    if (!fs.existsSync(path.join(cacheDir, filename))) {
      const row = findByFilename(filename);
      if (row) deleteByKey(row.cacheKey);
      missingRows += 1;
    }
  }

  songCacheLog.info(
    `[init] dir=${cacheDir} orphans.part=${partRemoved} orphan-files=${orphanFiles} missing-rows=${missingRows}`,
  );
};

/**
 * 为实际接收的字节腾出空间，保留预载文件及尚未删除成功的文件统计
 * @param incomingBytes - 本次准备写入的字节数
 * @returns 当前容量是否足以容纳新数据
 */
const evictIfNeeded = async (incomingBytes: number): Promise<boolean> => {
  const cap = sizeLimitBytes();
  let current = totalSize() + reservedBytes + incomingBytes;
  if (current <= cap) return true;

  let evicted = 0;
  let freed = 0;
  while (current > cap) {
    const victims = listLruVictims(EVICT_BATCH + 1).filter(
      (row) => row.filename !== preloadPin?.filename,
    );
    if (victims.length === 0) return false;
    for (const victim of victims) {
      if (victim.filename === preloadPin?.filename) continue;
      try {
        await fsp.unlink(absPath(victim.filename));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      deleteByKey(victim.cacheKey);
      current -= victim.size;
      freed += victim.size;
      evicted += 1;
      if (current <= cap) break;
    }
  }
  if (evicted > 0) songCacheLog.info(`[evict] count=${evicted} freed=${freed}`);
  return current <= cap;
};

/**
 * 实际下载实现
 * @param cacheKey - 缓存键
 * @param source - 来源
 * @param streamUrl - 流 URL
 * @param controller - 控制器
 * @returns 文件路径
 */
const runDownload = async (
  cacheKey: string,
  source: TrackSource,
  streamUrl: string,
  controller: AbortController,
): Promise<string | null> => {
  const start = Date.now();
  const filename = filenameFor(cacheKey);
  const finalPath = absPath(filename);
  const partPath = `${finalPath}.part`;
  let receivedBytes = 0;
  let renamed = false;
  let committed = false;

  try {
    await fsp.mkdir(cacheDir, { recursive: true });
    if (source === "streaming") {
      const identity = parseStreamingSource(streamUrl);
      streamUrl = (
        await resolveStreamingMediaSource(
          identity.serverId,
          identity.trackId,
          crypto.randomUUID(),
          controller.signal,
          identity.serverRevision,
        )
      ).url;
    }
    const response = await fetch(streamUrl, { signal: controller.signal });
    if (!response.ok || !response.body) {
      songCacheLog.warn(`[fetch] fail key=${cacheKey} status=${response.status}`);
      return null;
    }

    const mime = response.headers.get("content-type");
    // 拦截第三方代理常用 200+html 错误页冒充音频
    if (isRejectedMime(mime)) {
      songCacheLog.warn(`[fetch] reject mime key=${cacheKey} mime=${mime}`);
      return null;
    }
    const contentLengthHeader = response.headers.get("content-length");
    const declaredSize = contentLengthHeader ? Number(contentLengthHeader) : NaN;
    if (Number.isFinite(declaredSize) && declaredSize > sizeLimitBytes()) {
      songCacheLog.warn(`[fetch] skip oversize key=${cacheKey} declared=${declaredSize}`);
      return null;
    }

    const nodeStream = Readable.fromWeb(response.body as never);
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        void withBudget(async () => {
          controller.signal.throwIfAborted();
          if (receivedBytes + chunk.length > sizeLimitBytes()) {
            throw new Error("Song cache response exceeds size limit");
          }
          if (!(await evictIfNeeded(chunk.length))) {
            throw new Error("Song cache has no available capacity");
          }
          controller.signal.throwIfAborted();
          reservedBytes += chunk.length;
          receivedBytes += chunk.length;
        }).then(
          () => callback(null, chunk),
          (error: Error) => callback(error),
        );
      },
    });
    const writeStream = fs.createWriteStream(partPath);
    await pipeline(nodeStream, limiter, writeStream, { signal: controller.signal });

    const stat = await fsp.stat(partPath);
    if (stat.size === 0) {
      songCacheLog.warn(`[fetch] empty key=${cacheKey}`);
      return null;
    }
    if (stat.size > sizeLimitBytes()) {
      songCacheLog.warn(`[fetch] post oversize key=${cacheKey} actual=${stat.size}`);
      return null;
    }
    // 拦截首字节看着像音频才放行
    if (!(await looksLikeAudio(partPath))) {
      songCacheLog.warn(`[fetch] not audio key=${cacheKey} mime=${mime} size=${stat.size}`);
      return null;
    }

    await withBudget(async () => {
      controller.signal.throwIfAborted();
      if (!(await evictIfNeeded(0))) throw new Error("Song cache size limit changed");
      await fsp.rename(partPath, finalPath);
      renamed = true;
      const now = Date.now();
      upsert({
        cacheKey,
        source,
        filename,
        size: stat.size,
        mime,
        cachedAt: now,
        lastUsedAt: now,
      });
      reservedBytes -= receivedBytes;
      committed = true;
    });

    songCacheLog.info(`[fetch] done key=${cacheKey} size=${stat.size} ms=${Date.now() - start}`);
    return finalPath;
  } catch (err) {
    if (controller.signal.aborted) {
      songCacheLog.info(`[fetch] cancel key=${cacheKey}`);
    } else {
      songCacheLog.error(`[fetch] error key=${cacheKey}`, err);
    }
    return null;
  } finally {
    controller.abort();
    if (!committed) {
      await withBudget(async () => {
        try {
          await fsp.unlink(renamed ? finalPath : partPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            songCacheLog.error("[fetch] cleanup failed", error);
            return;
          }
        }
        reservedBytes -= receivedBytes;
      });
    }
  }
};

/** 启动初始化：建目录 + 孤儿清理 */
export const init = async (): Promise<void> => {
  cacheDir = getSongCacheDir();
  await fsp.mkdir(cacheDir, { recursive: true });
  await withBudget(cleanupOrphans);
  app.on("before-quit", () => {
    for (const entry of inFlight.values()) entry.controller.abort();
  });
};

/** 切换缓存目录后调用，让服务感知新前缀 */
export const reloadDir = (): void => {
  cacheDir = getSongCacheDir();
};

/** 查询命中；命中则更新 last_used_at 并返回本地绝对路径 */
export const lookup = async (cacheKey: string): Promise<string | null> => {
  if (!isCacheEnabled()) return null;
  const row = findByKey(cacheKey);
  if (!row) return null;
  const full = absPath(row.filename);
  if (!fs.existsSync(full)) {
    deleteByKey(cacheKey);
    return null;
  }
  touchLastUsed(cacheKey, Date.now());
  return full;
};

/**
 * 异步排队下载
 * @param cacheKey - 缓存键
 * @param source - 来源
 * @param streamUrl - 流 URL
 * @param preloadId - 可选的预载消费者标识，用于保留缓存文件和独立取消下载
 * @returns 已存在或下载完成的缓存路径，下载失败、被取消或不允许缓存时返回 null
 */
export const fetchAsync = (
  cacheKey: string,
  source: TrackSource,
  streamUrl: string,
  preloadId?: string,
): Promise<string | null> => {
  if (!isCacheEnabled()) return Promise.resolve(null);
  if (source === "streaming" && !store.get("cache.songCache.cacheStreaming"))
    return Promise.resolve(null);
  if (preloadId) preloadPin = { id: preloadId, filename: filenameFor(cacheKey) };
  const owner = preloadId ?? "background";
  const existing = inFlight.get(cacheKey);
  if (existing) {
    existing.owners.add(owner);
    return existing.promise;
  }
  const controller = new AbortController();
  const promise = (async () => {
    const acquired = await acquireSlot(controller.signal);
    if (!acquired) return null;
    try {
      if (controller.signal.aborted) return null;
      const cached = await lookup(cacheKey);
      return cached ?? (await runDownload(cacheKey, source, streamUrl, controller));
    } finally {
      if (inFlight.get(cacheKey)?.controller === controller) inFlight.delete(cacheKey);
      releaseSlot();
    }
  })();
  inFlight.set(cacheKey, { promise, controller, owners: new Set([owner]) });
  void promise
    .finally(() => {
      if (inFlight.get(cacheKey)?.controller === controller) inFlight.delete(cacheKey);
    })
    .catch(() => {});
  return promise;
};

/**
 * 取消正在进行的下载
 * @param cacheKey - 缓存键
 */
export const cancel = (cacheKey: string): void => {
  const entry = inFlight.get(cacheKey);
  if (entry) entry.controller.abort();
};

/**
 * 失效：删文件 + 删表
 * 如果表里没有或文件不存在则静默返回
 * @param sourcePath - 传入原始来源路径（streamUrl 或本地路径），用来找到对应的 cacheKey 和文件
 */
export const invalidate = async (sourcePath: string): Promise<void> => {
  if (path.dirname(sourcePath) !== cacheDir) return;
  const filename = path.basename(sourcePath);
  const row = findByFilename(filename);
  if (!row) return;
  await withBudget(async () => {
    try {
      await fsp.unlink(absPath(filename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        songCacheLog.warn(`[invalidate] 无法删除缓存文件：${filename}`, error);
        return;
      }
    }
    deleteByKey(row.cacheKey);
  });
  songCacheLog.info(`[invalidate] path=${sourcePath}`);
};

/** 清空全部 */
export const clearAll = async (): Promise<void> => {
  preloadPin = null;
  const pending = [...inFlight.values()];
  for (const entry of pending) entry.controller.abort();
  await Promise.allSettled(pending.map((entry) => entry.promise));
  await withBudget(async () => {
    let removedAll = true;
    try {
      const entries = await fsp.readdir(cacheDir);
      for (const name of entries) {
        try {
          await fsp.unlink(path.join(cacheDir, name));
          const row = findByFilename(name);
          if (row) deleteByKey(row.cacheKey);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") removedAll = false;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") removedAll = false;
    }
    if (removedAll && inFlight.size === 0) {
      dbClearAll();
      reservedBytes = 0;
    }
  });
  songCacheLog.info("[clearAll] done");
};

/** 占用统计 */
export const stats = (): { size: number; path: string } => ({
  size: totalSize(),
  path: cacheDir,
});
