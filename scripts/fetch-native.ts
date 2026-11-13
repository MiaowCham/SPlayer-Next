/**
 * 拉取原生模块二进制
 *
 * native/*\/*.node 不进仓库（体积大且需与上游一致），构建前若缺失则从上游
 * nightly 构件的 Windows 包中解出并替换。默认只在缺失时动作，`--force` 强制刷新。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** 上游仓库与构件来源 */
const UPSTREAM = "SPlayer-Dev/SPlayer-Next";
const RELEASE_TAG = "nightly";
const ASSET_PATTERN = /-x64-portable\.exe$/;

/** 需要存在的原生模块文件名 */
const REQUIRED = [
  "audio-capture/audio-capture.node",
  "audio-engine/audio-engine.node",
  "media-ctrl/media-ctrl.node",
  "opencc/opencc.node",
  "taskbar-lyric/taskbar-lyric.node",
  "taskbar-thumbnail/taskbar-thumbnail.node",
];

const root = path.resolve(import.meta.dirname, "..");
const nativeDir = path.join(root, "native");
const force = process.argv.includes("--force");

/**
 * 判断是否缺少任一原生模块
 * @returns 是否存在缺失文件
 */
const missing = (): boolean => REQUIRED.some((name) => !existsSync(path.join(nativeDir, name)));

/**
 * 查找可用的 7-Zip 可执行文件
 * @returns 可执行文件路径
 */
const find7z = (): string => {
  const candidates: string[] = [];
  const cacheRoot = path.join(root, "..", "_tools", "electron-builder-cache");
  if (existsSync(cacheRoot)) {
    for (const entry of readdirSync(cacheRoot)) {
      if (!entry.startsWith("7zip")) continue;
      const dir = path.join(cacheRoot, entry);
      for (const inner of readdirSync(dir)) {
        const candidate = path.join(dir, inner, "bin", "7za.exe");
        if (existsSync(candidate)) candidates.push(candidate);
      }
    }
  }
  const vendor = path.join(root, "node_modules", "electron-winstaller", "vendor", "7z-x64.exe");
  if (existsSync(vendor)) candidates.push(vendor);
  if (candidates.length === 0)
    throw new Error("未找到 7-Zip 可执行文件，请安装 7-Zip 或先打包一次");
  return candidates[0];
};

/**
 * 请求 GitHub API
 * @param url - 完整地址
 * @returns 解析后的响应体
 */
const api = async (url: string): Promise<any> => {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GitHub API ${response.status}`);
  return response.json();
};

/**
 * 下载文件到本地
 * @param url - 下载地址
 * @param target - 目标路径
 */
const download = async (url: string, target: string): Promise<void> => {
  const response = await fetch(url, { headers: { "User-Agent": "splayer-next-build" } });
  if (!response.ok || !response.body) throw new Error(`下载失败 ${response.status}`);
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(target));
};

const main = async (): Promise<void> => {
  if (!missing() && !force) {
    console.log("[native] 原生模块齐全，跳过拉取");
    return;
  }

  const tmpDir = path.join(root, "node_modules", ".cache", "native-fetch");
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  const release = await api(
    `https://api.github.com/repos/${UPSTREAM}/releases/tags/${RELEASE_TAG}`,
  );
  const asset = (release.assets as any[]).find((item) => ASSET_PATTERN.test(item.name));
  if (!asset) throw new Error("上游 nightly 未找到 Windows x64 构件");

  const archive = path.join(tmpDir, asset.name);
  console.log(`[native] 下载 ${asset.name} (${(asset.size / 1048576).toFixed(1)} MB)`);
  await download(asset.browser_download_url, archive);

  const seven = find7z();
  const unpacked = path.join(tmpDir, "unpacked");
  mkdirSync(unpacked, { recursive: true });
  execFileSync(seven, ["x", archive, `-o${unpacked}`, "-y"], { stdio: "inherit" });

  const source = path.join(unpacked, "resources", "native");
  if (!existsSync(source)) throw new Error("构件中未找到 resources/native");

  for (const name of REQUIRED) {
    const from = path.join(source, path.basename(name));
    if (!existsSync(from)) throw new Error(`构件缺少 ${name}`);
    const target = path.join(nativeDir, name);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(from, target);
    const size = (statSync(target).size / 1048576).toFixed(1);
    console.log(`[native] ${name} ${size} MB`);
  }

  await writeFile(
    path.join(nativeDir, "native-source.json"),
    JSON.stringify(
      {
        upstream: UPSTREAM,
        tag: RELEASE_TAG,
        asset: asset.name,
        fetchedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  rmSync(tmpDir, { recursive: true, force: true });
  console.log("[native] 完成");
};

void main();
