// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const runtime = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@main/apis/netease", () => ({
  callNetease: vi.fn(async () => ({ status: 200, body: { songs: [] } })),
}));
vi.mock("@main/database/managedLyrics", () => ({ setManagedLyric: runtime.save }));
vi.mock("@main/services/localLyricRepo", () => ({ extractTtmlMeta: () => ({ ncmId: "123" }) }));
vi.mock("@main/utils/logger", () => ({ coreLog: { warn: vi.fn() } }));
import { importNeteaseTtmlDirectory } from "./managedLyricImport";

let dir: string;
const valid =
  '<tt><body><div><p begin="0s" end="2s">\n<span begin="0s" end="1s">Hello </span>\n<span begin="1s" end="2s">world</span>\n</p></div></body></tt>';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "splayer-import-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("批量手动导入格式化 TTML", () => {
  it.each([true, false])("集中警告一次，继续导入选择为 %s", async (proceed) => {
    fs.writeFileSync(path.join(dir, "valid.ttml"), valid);
    fs.writeFileSync(path.join(dir, "bad-a.ttml"), valid.replace("Hello ", "Hello"));
    fs.writeFileSync(path.join(dir, "bad-b.ttml"), valid.replace("Hello ", "Hello"));
    const confirm = vi.fn(async () => proceed);
    const result = await importNeteaseTtmlDirectory(dir, confirm);
    expect(confirm).toHaveBeenCalledExactlyOnceWith(2);
    expect(result).toEqual({
      imported: proceed ? 3 : 1,
      replaced: 0,
      skipped: proceed ? 0 : 2,
      failed: 0,
    });
    expect(runtime.save).toHaveBeenCalledTimes(proceed ? 3 : 1);
  });

  it("正常文件不弹警告且保留原始美化文本", async () => {
    fs.writeFileSync(path.join(dir, "valid.ttml"), valid);
    const confirm = vi.fn(async () => false);
    await importNeteaseTtmlDirectory(dir, confirm);
    expect(confirm).not.toHaveBeenCalled();
    expect(runtime.save.mock.calls[0][1]).toEqual({ content: valid, format: "ttml" });
  });
});
