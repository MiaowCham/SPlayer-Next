// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SongCacheRow } from "@main/database/songCache";

const state = vi.hoisted(() => ({
  directory: "",
  rows: new Map<string, SongCacheRow>(),
  limit: 64 / 1024 ** 3,
  resolveMedia: vi.fn(),
}));
vi.mock("@main/services/streaming/mediaSource", () => ({
  resolveStreamingMediaSource: state.resolveMedia,
}));
vi.mock("electron", () => ({ app: { on: vi.fn() } }));
vi.mock("@main/utils/config", () => ({ getSongCacheDir: () => state.directory }));
vi.mock("@main/utils/logger", () => ({
  songCacheLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@main/store", () => ({
  store: { get: (key: string) => (key.endsWith("sizeLimitGb") ? state.limit : true) },
}));
vi.mock("@main/database/songCache", () => ({
  findByKey: (key: string) => state.rows.get(key),
  findByFilename: (filename: string) =>
    [...state.rows.values()].find((row) => row.filename === filename),
  upsert: (row: SongCacheRow) => state.rows.set(row.cacheKey, row),
  deleteByKey: (key: string) => state.rows.delete(key),
  clearAll: () => state.rows.clear(),
  touchLastUsed: vi.fn(),
  listAllFilenames: () => [...state.rows.values()].map((row) => row.filename),
  listLruVictims: (limit: number) => [...state.rows.values()].slice(0, limit),
  totalSize: () => [...state.rows.values()].reduce((sum, row) => sum + row.size, 0),
}));

/**
 * 构造供真实流写入流程使用的固定大小音频响应
 * @returns 带音频类型和长度声明的测试响应
 */
const audioResponse = (): Response =>
  new Response(Buffer.alloc(32, 1), {
    headers: { "content-type": "audio/wav", "content-length": "32" },
  });

describe("歌曲预载缓存生命周期", () => {
  beforeEach(async () => {
    vi.resetModules();
    state.rows.clear();
    state.limit = 64 / 1024 ** 3;
    state.resolveMedia.mockReset().mockResolvedValue({ url: "https://server/audio?token=private" });
    state.directory = await fs.mkdtemp(path.join(os.tmpdir(), "splayer-cache-test-"));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(state.directory, { recursive: true, force: true });
  });

  it("流媒体缓存只在主进程解析认证地址", async () => {
    const fetcher = vi.fn(async (_url: string, _options: RequestInit) => audioResponse());
    vi.stubGlobal("fetch", fetcher);
    const cache = await import("./songCache");
    expect(await cache.fetchAsync("remote", "streaming", "streaming://server/song")).not.toBeNull();
    expect(state.resolveMedia).toHaveBeenCalledWith(
      "server",
      "song",
      expect.any(String),
      expect.any(AbortSignal),
      0,
    );
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://server/audio?token=private");
    expect(state.rows.get("remote")).not.toHaveProperty("url");
  });

  it("取消预载消费者不会中断共用的后台下载", async () => {
    let finish!: (response: Response) => void;
    let signal!: AbortSignal;
    const fetcher = vi.fn((_url: string, options: RequestInit) => {
      signal = options.signal!;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const cache = await import("./songCache");
    const preload = cache.fetchAsync("same", "netease", "https://music/same", "preload");
    const background = cache.fetchAsync("same", "netease", "https://music/same");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    cache.cancelPreload("preload");
    expect(signal.aborted).toBe(false);
    finish(audioResponse());
    expect(await preload).toBe(await background);
    expect(await background).not.toBeNull();
  });

  it("取消排队的预载不会占用下载槽位或留下待执行任务", async () => {
    const finishes: Array<(response: Response) => void> = [];
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finishes.push(resolve);
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const cache = await import("./songCache");
    const first = cache.fetchAsync("first", "netease", "https://music/first");
    const second = cache.fetchAsync("second", "netease", "https://music/second");
    const queued = cache.fetchAsync("queued", "netease", "https://music/queued", "queued");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    cache.cancelPreload("queued");
    expect(await queued).toBeNull();
    finishes.splice(0).forEach((finish) => finish(audioResponse()));
    await Promise.all([first, second]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const next = cache.fetchAsync("next", "netease", "https://music/next");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    finishes[0]!(audioResponse());
    expect(await next).not.toBeNull();
  });

  it("取消唯一下载消费者会终止网络请求", async () => {
    const fetcher = vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal!.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const cache = await import("./songCache");
    const preload = cache.fetchAsync("cancel", "netease", "https://music/cancel", "cancel");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    cache.cancelPreload("cancel");
    expect(await preload).toBeNull();
    expect(state.rows.size).toBe(0);
  });

  it("LRU 保留已准备的音源，释放租约后可以正常淘汰", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => audioResponse()),
    );
    const cache = await import("./songCache");
    const pinned = await cache.fetchAsync("pinned", "netease", "https://music/pinned", "next");
    await cache.fetchAsync("second", "netease", "https://music/second");
    await cache.fetchAsync("third", "netease", "https://music/third");
    expect(await fs.stat(pinned!)).toBeDefined();
    expect(state.rows.has("pinned")).toBe(true);
    expect(state.rows.has("second")).toBe(false);
    cache.cancelPreload("next");
    await cache.fetchAsync("fourth", "netease", "https://music/fourth");
    expect(state.rows.has("pinned")).toBe(false);
  });

  it.each([undefined, "1"])("真实字节超限时中止响应，不能依赖长度头 %s", async (length) => {
    let pulls = 0;
    const canceled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(32).fill(1));
        if (pulls === 10000) controller.close();
      },
      cancel: canceled,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(body, {
            headers: length ? { "content-length": length } : {},
          }),
      ),
    );
    const cache = await import("./songCache");
    expect(await cache.fetchAsync("infinite", "netease", "https://music/infinite")).toBeNull();
    expect(canceled).toHaveBeenCalled();
    expect(pulls).toBeLessThan(10000);
    expect(await fs.readdir(state.directory)).toEqual([]);
    expect(state.rows.size).toBe(0);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => audioResponse()),
    );
    expect(await cache.fetchAsync("valid", "netease", "https://music/valid")).not.toBeNull();
  });

  it("第一块数据超过容量时不写盘", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(Buffer.alloc(65, 1))),
    );
    const cache = await import("./songCache");
    expect(await cache.fetchAsync("large", "netease", "https://music/large")).toBeNull();
    expect(await fs.readdir(state.directory)).toEqual([]);
    expect(state.rows.size).toBe(0);
  });

  it("两个未完成下载共享容量，不能分别使用完整上限", async () => {
    const controllers = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controllers.set(url, controller);
                controller.enqueue(new Uint8Array(24).fill(1));
              },
            }),
          ),
      ),
    );
    const cache = await import("./songCache");
    const first = cache.fetchAsync("first", "netease", "https://music/first");
    const second = cache.fetchAsync("second", "netease", "https://music/second");
    try {
      await vi.waitFor(async () => {
        const files = await fs.readdir(state.directory);
        const sizes = await Promise.all(
          files.map(async (file) => (await fs.stat(path.join(state.directory, file))).size),
        );
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(48);
      });
      controllers.get("https://music/first")!.enqueue(new Uint8Array(24).fill(1));
      controllers.get("https://music/first")!.close();
      expect(await first).toBeNull();
      controllers.get("https://music/second")!.close();
      expect(await second).not.toBeNull();
      expect([...state.rows.values()].reduce((sum, row) => sum + row.size, 0)).toBe(24);
      expect((await fs.readdir(state.directory)).some((name) => name.endsWith(".part"))).toBe(
        false,
      );
    } finally {
      cache.cancel("first");
      cache.cancel("second");
      await Promise.allSettled([first, second]);
    }
  });

  it("已有预载占满容量时保留它并放弃新缓存", async () => {
    state.limit = 32 / 1024 ** 3;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => audioResponse()),
    );
    const cache = await import("./songCache");
    const pinned = await cache.fetchAsync("pinned", "netease", "https://music/pinned", "preload");
    expect(await cache.fetchAsync("other", "netease", "https://music/other")).toBeNull();
    expect((await fs.stat(pinned!)).size).toBe(32);
    cache.cancelPreload("preload");
    expect(await cache.fetchAsync("next", "netease", "https://music/next")).not.toBeNull();
  });

  it("淘汰文件删除失败时不虚报已释放容量", async () => {
    state.limit = 32 / 1024 ** 3;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => audioResponse()),
    );
    const cache = await import("./songCache");
    const original = await cache.fetchAsync("original", "netease", "https://music/original");
    const unlink = fs.unlink.bind(fs);
    vi.spyOn(fs, "unlink").mockImplementation(async (file) => {
      if (file === original) throw Object.assign(new Error("locked"), { code: "EPERM" });
      return unlink(file);
    });
    expect(await cache.fetchAsync("other", "netease", "https://music/other")).toBeNull();
    expect(state.rows.has("original")).toBe(true);
    expect((await fs.stat(original!)).size).toBe(32);
  });

  it("真实 HTTP 压缩响应按解压后的流量限额", async () => {
    const payload = gzipSync(Buffer.alloc(4096, 1));
    expect(payload.length).toBeLessThan(64);
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "content-type": "audio/wav",
        "content-encoding": "gzip",
        "content-length": String(payload.length),
      });
      response.end(payload);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address() as { port: number };
      const cache = await import("./songCache");
      expect(
        await cache.fetchAsync("gzip", "netease", `http://127.0.0.1:${address.port}/audio`),
      ).toBeNull();
      expect(await fs.readdir(state.directory)).toEqual([]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("不限制容量的配置仍允许较大的响应", async () => {
    state.limit = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(Buffer.alloc(1024, 1))),
    );
    const cache = await import("./songCache");
    const file = await cache.fetchAsync("unlimited", "netease", "https://music/unlimited");
    expect((await fs.stat(file!)).size).toBe(1024);
  });

  it.each(["leftover.bin.part", "orphan.bin"])("启动时无法删除的 %s 仍占用容量", async (name) => {
    const leftover = path.join(state.directory, name);
    await fs.writeFile(leftover, Buffer.alloc(64, 1));
    const unlink = fs.unlink.bind(fs);
    const spy = vi.spyOn(fs, "unlink").mockImplementation(async (file) => {
      if (file === leftover) throw Object.assign(new Error("locked"), { code: "EPERM" });
      return unlink(file);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => audioResponse()),
    );
    const cache = await import("./songCache");
    await cache.init();
    expect(await cache.fetchAsync("fresh", "netease", "https://music/fresh")).toBeNull();
    expect(await fs.readdir(state.directory)).toEqual([name]);
    spy.mockRestore();
    await cache.clearAll();
    expect(await cache.fetchAsync("fresh", "netease", "https://music/fresh")).not.toBeNull();
  });

  it("失效缓存删除失败时保留统计且不替换原有播放错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => audioResponse()),
    );
    const cache = await import("./songCache");
    const original = await cache.fetchAsync("original", "netease", "https://music/original");
    const unlink = fs.unlink.bind(fs);
    vi.spyOn(fs, "unlink").mockImplementation(async (file) => {
      if (file === original) throw Object.assign(new Error("locked"), { code: "EPERM" });
      return unlink(file);
    });
    await expect(cache.invalidate(original!)).resolves.toBeUndefined();
    expect(state.rows.has("original")).toBe(true);
    expect((await fs.stat(original!)).size).toBe(32);
  });

  it("启动时无法枚举目录占用时不继续使用有限缓存额度", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => audioResponse()),
    );
    const cache = await import("./songCache");
    vi.spyOn(fs, "readdir").mockRejectedValueOnce(
      Object.assign(new Error("locked"), { code: "EACCES" }),
    );
    await cache.init();
    expect(await cache.fetchAsync("unknown", "netease", "https://music/unknown")).toBeNull();
    expect(await fs.readdir(state.directory)).toEqual([]);
    await cache.clearAll();
    expect(await cache.fetchAsync("known", "netease", "https://music/known")).not.toBeNull();
  });
});
