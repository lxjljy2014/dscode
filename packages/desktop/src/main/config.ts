import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { AppSettings, PermissionMode, SettingsPatch } from '@dscode/shared';

/**
 * 应用设置的 JSON 持久化（userData/settings.json）。
 * 工作目录与权限模式随应用重启保留。
 */

function isPermissionMode(v: unknown): v is PermissionMode {
  return v === 'confirm' || v === 'auto-edit' || v === 'plan' || v === 'full-access';
}

export function defaultSettings(homeDir: string): AppSettings {
  return { workingDirectory: homeDir, permissionMode: 'confirm' };
}

/** 加载 + 归一化：非法字段回退默认值 */
export function loadSettings(file: string, homeDir: string): AppSettings {
  const defaults = defaultSettings(homeDir);
  try {
    if (!existsSync(file)) return defaults;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const workingDirectory =
      typeof raw['workingDirectory'] === 'string' ? raw['workingDirectory'] : defaults.workingDirectory;
    const permissionMode = isPermissionMode(raw['permissionMode']) ? raw['permissionMode'] : defaults.permissionMode;
    return { workingDirectory, permissionMode };
  } catch {
    return defaults;
  }
}

/** 合并 patch 并落盘，返回最新设置 */
export function saveSettings(file: string, homeDir: string, patch: SettingsPatch): AppSettings {
  const current = loadSettings(file, homeDir);
  const next: AppSettings = {
    workingDirectory:
      typeof patch.workingDirectory === 'string' && patch.workingDirectory.length > 0
        ? patch.workingDirectory
        : current.workingDirectory,
    permissionMode: isPermissionMode(patch.permissionMode) ? patch.permissionMode : current.permissionMode
  };
  writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
