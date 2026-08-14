import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { AppSettings, PermissionMode, ProviderConfig, SettingsPatch } from '@dscode/shared';

/**
 * 应用设置的 JSON 持久化（userData/settings.json）。
 * 工作目录、权限模式、AI 供应商配置与引导状态随应用重启保留。
 */

function isPermissionMode(v: unknown): v is PermissionMode {
  return v === 'confirm' || v === 'auto-edit' || v === 'plan' || v === 'full-access';
}

/** 供应商配置收窄：字段齐全且类型正确才保留 */
function isProviderConfig(v: unknown): v is ProviderConfig {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p['id'] === 'string' &&
    typeof p['name'] === 'string' &&
    typeof p['baseUrl'] === 'string' &&
    typeof p['apiKey'] === 'string' &&
    Array.isArray(p['models']) &&
    p['models'].every(m => typeof m === 'string')
  );
}

export function defaultSettings(homeDir: string): AppSettings {
  return { workingDirectory: homeDir, permissionMode: 'confirm', providers: [], onboardingDone: false };
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
    const providers = Array.isArray(raw['providers']) ? raw['providers'].filter(isProviderConfig) : defaults.providers;
    const onboardingDone =
      typeof raw['onboardingDone'] === 'boolean' ? raw['onboardingDone'] : defaults.onboardingDone;
    return { workingDirectory, permissionMode, providers, onboardingDone };
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
    permissionMode: isPermissionMode(patch.permissionMode) ? patch.permissionMode : current.permissionMode,
    providers: Array.isArray(patch.providers) ? patch.providers.filter(isProviderConfig) : current.providers,
    onboardingDone: typeof patch.onboardingDone === 'boolean' ? patch.onboardingDone : current.onboardingDone
  };
  writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
