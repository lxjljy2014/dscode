import { safeStorage } from 'electron';
import { loadSettings, saveSettings } from '@dscode/core';
import type { SettingsCrypto } from '@dscode/core';
import type { AppSettings, SettingsPatch } from '@dscode/shared';

/**
 * 应用设置的 Electron 封装：为 apiKey 静态加密注入 safeStorage。
 * core 的 config.ts 保持无 Electron 依赖，加密/解密在此层实现。配置目录由 data-dir 提供（~/.dscode/config）。
 */

const ENC_PREFIX = 'enc:v1:';

/** 构造 safeStorage 加密钩子；系统不可用（如无 keyring）时返回 undefined 退回明文 */
function makeCrypto(): SettingsCrypto | undefined {
  if (!safeStorage.isEncryptionAvailable()) return undefined;
  return {
    encrypt: (plain: string) =>
      plain.length === 0 ? plain : ENC_PREFIX + safeStorage.encryptString(plain).toString('base64'),
    decrypt: (value: string) => {
      // 历史明文 / 空串直接返回
      if (!value.startsWith(ENC_PREFIX)) return value;
      try {
        return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'));
      } catch {
        // 解密失败（如跨机器迁移、keyring 变更）退回原值，避免设置被清空；需用户重新填写 key
        return value;
      }
    }
  };
}

export function loadAppSettings(configDir: string, homeDir: string): AppSettings {
  return loadSettings(configDir, homeDir, makeCrypto());
}

export function saveAppSettings(configDir: string, homeDir: string, patch: SettingsPatch): AppSettings {
  return saveSettings(configDir, homeDir, patch, makeCrypto());
}