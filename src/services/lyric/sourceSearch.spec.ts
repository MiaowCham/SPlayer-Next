import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchLyricVersions } from "./sourceSearch";
const state = vi.hoisted(() => ({ search: vi.fn(), builtin: vi.fn() }));
vi.mock("@/apis/search", () => ({ searchSongs: state.search }));
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => vi.stubGlobal("api", { lyrics: { searchSourceTracks: state.builtin } }));

describe("单来源版本搜索分发", () => {
  it("保留模糊命中的所有结果与分页信息，仅查询一个平台", async () => {
    state.search.mockResolvedValue({
      items: [
        {
          id: "mid",
          extId: "123",
          title: "同名歌曲",
          artists: [{ name: "其他歌手" }],
          duration: 3000,
        },
        { id: "mid2", extId: "456", title: "翻唱", artists: [], duration: 5000 },
      ],
      total: 400,
      hasMore: true,
    });
    const page = await searchLyricVersions({ origin: "qqmusic" }, "模糊关键词", 50);
    expect(state.search).toHaveBeenCalledExactlyOnceWith("qqmusic", "模糊关键词", 50, 50);
    expect(page).toMatchObject({
      total: 400,
      hasMore: true,
      items: [
        { id: "123", mid: "mid" },
        { id: "456", mid: "mid2" },
      ],
    });
    expect(state.builtin).not.toHaveBeenCalled();
  });
  it("AMLL 仅搜索绑定平台，不枚举其他平台", async () => {
    state.search.mockResolvedValue({ items: [], total: 0, hasMore: false });
    await searchLyricVersions({ origin: "amll", platform: "netease" }, "song", 0);
    expect(state.search).toHaveBeenCalledExactlyOnceWith("netease", "song", 0, 50);
  });
  it("本地词库走独立索引查询，不调用平台搜索", async () => {
    state.builtin.mockResolvedValue({ items: [], hasMore: false });
    await searchLyricVersions({ origin: "localTtml" }, "song", 0);
    expect(state.builtin).toHaveBeenCalledExactlyOnceWith(
      { origin: "localTtml", platform: undefined },
      "song",
      0,
    );
    expect(state.search).not.toHaveBeenCalled();
  });
});
