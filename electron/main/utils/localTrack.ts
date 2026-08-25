import { createHash } from "node:crypto";

/**
 * 根据本地音频路径生成稳定曲目 ID。
 * @param filePath - 本地音频或 CUE 虚拟曲目路径
 * @returns SHA-256 前 16 位
 */
export const createLocalTrackId = (filePath: string): string =>
  createHash("sha256").update(filePath).digest("hex").slice(0, 16);
