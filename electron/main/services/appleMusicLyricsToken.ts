import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import { writeFileSync as atomicWriteSync } from "atomically";
import { configDir } from "@main/utils/paths";

const STORAGE_FILE = path.join(configDir, "apple-music-lyrics.json");

interface PersistedToken {
  encryptedMediaUserToken?: string;
  /** 兼容模式下的明文值；仅为兼容旧插件行为而保留。 */
  mediaUserToken?: string;
  storage?: "secure" | "compatibility";
}

type AppleMusicTokenStorage = "secure" | "compatibility";

/** 获取当前令牌的存储方式；旧版加密记录按安全模式处理。 */
export const getAppleMusicMediaUserTokenStorage = (): AppleMusicTokenStorage => {
  try {
    const raw = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf8")) as PersistedToken;
    return raw.storage === "compatibility" ? "compatibility" : "secure";
  } catch {
    return "secure";
  }
};

/** 查询是否已安全保存 Apple Music 用户令牌。 */
export const hasAppleMusicMediaUserToken = (): boolean => {
  try {
    const raw = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf8")) as PersistedToken;
    return !!raw.encryptedMediaUserToken || !!raw.mediaUserToken;
  } catch {
    return false;
  }
};

/** 读取解密后的 Apple Music 用户令牌，仅供主进程歌词服务调用。 */
export const getAppleMusicMediaUserToken = (): string => {
  try {
    const raw = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf8")) as PersistedToken;
    if (raw.storage === "compatibility") return raw.mediaUserToken ?? "";
    if (!safeStorage.isEncryptionAvailable()) return "";
    return raw.encryptedMediaUserToken
      ? safeStorage.decryptString(Buffer.from(raw.encryptedMediaUserToken, "base64"))
      : "";
  } catch {
    return "";
  }
};

/** 保存或清除 Apple Music 用户令牌，拒绝降级为明文存储。 */
export const saveAppleMusicMediaUserToken = (
  token: string,
  storage: AppleMusicTokenStorage = "secure",
): boolean => {
  if (storage === "secure" && !safeStorage.isEncryptionAvailable()) {
    throw new Error("系统安全存储不可用，无法保存 Apple Music Token");
  }
  const value = token.trim();
  if (!value) {
    if (fs.existsSync(STORAGE_FILE)) fs.rmSync(STORAGE_FILE);
    return false;
  }
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  const persisted: PersistedToken =
    storage === "compatibility"
      ? { storage, mediaUserToken: value }
      : { storage, encryptedMediaUserToken: safeStorage.encryptString(value).toString("base64") };
  atomicWriteSync(STORAGE_FILE, JSON.stringify(persisted, null, 2));
  return true;
};

/** 不向渲染进程暴露令牌，将现有值切换至指定存储方式。 */
export const migrateAppleMusicMediaUserTokenStorage = (
  storage: AppleMusicTokenStorage,
): boolean => {
  const token = getAppleMusicMediaUserToken();
  return token ? saveAppleMusicMediaUserToken(token, storage) : false;
};
