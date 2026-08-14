import { existsSync, readFileSync, writeFileSync } from 'node:fs';
// 经子路径出口导入运行时值：主进程外部化 @dscode/shared 后由 Node 直接加载，
// 主入口 index.ts 的目录 re-export（./types）在 Node ESM 下不可解析
import { DEEPSEEK_PRESET } from '@dscode/shared/settings';
import type { AppSettings, PermissionMode, ProviderConfig, SettingsPatch } from '@dscode/shared';

/**
 * 应用设置的 JSON 持久化（userData/settings.json）。
 * 工作目录、权限模式、AI 供应商配置与引导状态随应用重启保留。
 * 通过可选 crypto 钩子支持 apiKey 静态加密（Electron safeStorage 由 desktop 层注入，core 保持无 Electron 依赖）。
 */

/** 静态加密钩子：desktop 注入 safeStorage 实现；缺省则明文存储 */
export interface SettingsCrypto {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

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
    p['models'].every(m => typeof m === 'string') &&
    (p['adapter'] === undefined || typeof p['adapter'] === 'string')
  );
}

/**
 * 预置供应商归一化：模型列表与适配器强制对齐 DEEPSEEK_PRESET，
 * 防旧数据漂移（如已下线的 deepseek-chat 残留、缺失的 adapter 字段）。
 */
function normalizeProviders(providers: ProviderConfig[]): ProviderConfig[] {
  return providers.map(p =>
    p.id === DEEPSEEK_PRESET.id
      ? { ...p, models: DEEPSEEK_PRESET.models, adapter: p.adapter ?? DEEPSEEK_PRESET.adapter }
      : p
  );
}

function decryptProviders(providers: ProviderConfig[], crypto?: SettingsCrypto): ProviderConfig[] {
  if (!crypto) return providers;
  return providers.map(p => {
    try {
      return { ...p, apiKey: crypto.decrypt(p.apiKey) };
    } catch {
      return p;
    }
  });
}

function encryptProviders(providers: ProviderConfig[], crypto?: SettingsCrypto): ProviderConfig[] {
  if (!crypto) return providers;
  return providers.map(p => {
    try {
      return { ...p, apiKey: crypto.encrypt(p.apiKey) };
    } catch {
      return p;
    }
  });
}

export function defaultSettings(homeDir: string): AppSettings {
  return { workingDirectory: homeDir, permissionMode: 'confirm', providers: [], onboardingDone: false };
}

/** 加载 + 归一化 + 解密：非法字段回退默认值 */
export function loadSettings(file: string, homeDir: string, crypto?: SettingsCrypto): AppSettings {
  const defaults = defaultSettings(homeDir);
  try {
    if (!existsSync(file)) return defaults;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const workingDirectory =
      typeof raw['workingDirectory'] === 'string' ? raw['workingDirectory'] : defaults.workingDirectory;
    const permissionMode = isPermissionMode(raw['permissionMode']) ? raw['permissionMode'] : defaults.permissionMode;
    const providers = normalizeProviders(
      Array.isArray(raw['providers']) ? raw['providers'].filter(isProviderConfig) : defaults.providers
    );
    const onboardingDone = typeof raw['onboardingDone'] === 'boolean' ? raw['onboardingDone'] : defaults.onboardingDone;
    return { workingDirectory, permissionMode, providers: decryptProviders(providers, crypto), onboardingDone };
  } catch {
    return defaults;
  }
}

/** 合并 patch、加密 apiKey 后落盘，返回最新设置（返回值为解密后的明文，供调用方使用） */
export function saveSettings(
  file: string,
  homeDir: string,
  patch: SettingsPatch,
  crypto?: SettingsCrypto
): AppSettings {
  const current = loadSettings(file, homeDir, crypto);
  const next: AppSettings = {
    workingDirectory:
      typeof patch.workingDirectory === 'string' && patch.workingDirectory.length > 0
        ? patch.workingDirectory
        : current.workingDirectory,
    permissionMode: isPermissionMode(patch.permissionMode) ? patch.permissionMode : current.permissionMode,
    providers: normalizeProviders(
      Array.isArray(patch.providers) ? patch.providers.filter(isProviderConfig) : current.providers
    ),
    onboardingDone: typeof patch.onboardingDone === 'boolean' ? patch.onboardingDone : current.onboardingDone
  };
  const persisted: AppSettings = { ...next, providers: encryptProviders(next.providers, crypto) };
  writeFileSync(file, JSON.stringify(persisted, null, 2), 'utf8');
  return next;
}
