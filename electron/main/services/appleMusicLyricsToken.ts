import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import { writeFileSync as atomicWriteSync } from "atomically";
import { configDir } from "@main/utils/paths";

const STORAGE_FILE = path.join(configDir, "apple-music-lyrics.json");

interface PersistedToken {
  encryptedMediaUserToken: string;
}

/** 查询是否已安全保存 Apple Music 用户令牌。 */
export const hasAppleMusicMediaUserToken = (): boolean => {
  try {
    const raw = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf8")) as PersistedToken;
    return !!raw.encryptedMediaUserToken;
  } catch {
    return false;
  }
};

/** 读取解密后的 Apple Music 用户令牌，仅供主进程歌词服务调用。 */
export const getAppleMusicMediaUserToken = (): string => {
  try {
    if (!safeStorage.isEncryptionAvailable()) return "";
    const raw = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf8")) as PersistedToken;
    return raw.encryptedMediaUserToken
      ? safeStorage.decryptString(Buffer.from(raw.encryptedMediaUserToken, "base64"))
      : "";
  } catch {
    return "";
  }
};

/** 保存或清除 Apple Music 用户令牌，拒绝降级为明文存储。 */
export const saveAppleMusicMediaUserToken = (token: string): boolean => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("系统安全存储不可用，无法保存 Apple Music Token");
  }
  const value = token.trim();
  if (!value) {
    if (fs.existsSync(STORAGE_FILE)) fs.rmSync(STORAGE_FILE);
    return false;
  }
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  atomicWriteSync(
    STORAGE_FILE,
    JSON.stringify(
      { encryptedMediaUserToken: safeStorage.encryptString(value).toString("base64") },
      null,
      2,
    ),
  );
  return true;
};
