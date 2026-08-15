import { existsSync, readFileSync, writeFileSync } from 'node:fs';
// 经子路径出口导入运行时值：主进程外部化 @dscode/shared 后由 Node 直接加载，
// 主入口 index.ts 的目录 re-export（./types）在 Node ESM 下不可解析
import { DEFAULT_SUBAGENTS, DEEPSEEK_PRESET } from '@dscode/shared/settings';
import type {
  AppSettings,
  Command,
  Hook,
  HookTrigger,
  McpServer,
  MemoryEntry,
  PermissionMode,
  ProviderConfig,
  SettingsPatch,
  Skill,
  Subagent
} from '@dscode/shared';

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
    (p['adapter'] === undefined || typeof p['adapter'] === 'string') &&
    (p['thinking'] === undefined || typeof p['thinking'] === 'boolean') &&
    (p['reasoningEffort'] === undefined ||
      p['reasoningEffort'] === 'off' ||
      p['reasoningEffort'] === 'high' ||
      p['reasoningEffort'] === 'max') &&
    (p['maxTokens'] === undefined ||
      (typeof p['maxTokens'] === 'number' && Number.isFinite(p['maxTokens']) && p['maxTokens'] > 0)) &&
    (p['contextWindow'] === undefined ||
      (typeof p['contextWindow'] === 'number' && Number.isFinite(p['contextWindow']) && p['contextWindow'] > 0))
  );
}

/** 斜杠命令收窄：字段齐全且类型正确才保留 */
/** 记忆条目收窄 */
function isMemoryEntry(v: unknown): v is MemoryEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e['id'] === 'string' && typeof e['content'] === 'string';
}

/** 技能收窄 */
function isSkill(v: unknown): v is Skill {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s['id'] === 'string' &&
    typeof s['name'] === 'string' &&
    typeof s['description'] === 'string' &&
    typeof s['instructions'] === 'string'
  );
}

function isHookTrigger(v: unknown): v is HookTrigger {
  return v === 'session_start' || v === 'session_end' || v === 'tool_done';
}

/** 钩子收窄 */
function isHook(v: unknown): v is Hook {
  if (typeof v !== 'object' || v === null) return false;
  const h = v as Record<string, unknown>;
  return (
    typeof h['id'] === 'string' &&
    typeof h['name'] === 'string' &&
    isHookTrigger(h['trigger']) &&
    typeof h['command'] === 'string'
  );
}

/** 子智能体收窄 */
function isSubagent(v: unknown): v is Subagent {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s['id'] === 'string' &&
    typeof s['name'] === 'string' &&
    typeof s['description'] === 'string' &&
    typeof s['systemPrompt'] === 'string'
  );
}

/** MCP 服务器收窄 */
function isMcpServer(v: unknown): v is McpServer {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s['id'] === 'string' &&
    typeof s['name'] === 'string' &&
    typeof s['command'] === 'string' &&
    Array.isArray(s['args']) &&
    s['args'].every(a => typeof a === 'string')
  );
}

function isCommand(v: unknown): v is Command {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c['id'] === 'string' &&
    typeof c['name'] === 'string' &&
    typeof c['description'] === 'string' &&
    typeof c['prompt'] === 'string'
  );
}

/**
 * 预置供应商归一化：模型列表与适配器强制对齐 DEEPSEEK_PRESET，
 * 防旧数据漂移（如已下线的 deepseek-chat 残留、缺失的 adapter 字段）。
 */
function normalizeProviders(providers: ProviderConfig[]): ProviderConfig[] {
  return providers.map(p =>
    p.id === DEEPSEEK_PRESET.id
      ? {
          ...p,
          // 模型列表以用户配置为准；仅空列表回退预置（首次创建/旧数据缺省兜底，之后允许自定义）
          models: p.models.length > 0 ? p.models : DEEPSEEK_PRESET.models,
          adapter: p.adapter ?? DEEPSEEK_PRESET.adapter,
          // 输出上限对齐官方默认 256K；旧数据缺省自动补齐（用户显式配置的值保留）
          maxTokens: p.maxTokens ?? DEEPSEEK_PRESET.maxTokens,
          // 上下文窗口对齐官方默认 1M；旧数据缺省自动补齐
          contextWindow: p.contextWindow ?? DEEPSEEK_PRESET.contextWindow
        }
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
  return {
    workingDirectory: homeDir,
    permissionMode: 'confirm',
    providers: [],
    onboardingDone: false,
    commands: [],
    memory: [],
    skills: [],
    hooks: [],
    subagents: [...DEFAULT_SUBAGENTS],
    mcpServers: [],
    browsingEnabled: true
  };
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
    const commands = Array.isArray(raw['commands']) ? raw['commands'].filter(isCommand) : [];
    const memory = Array.isArray(raw['memory']) ? raw['memory'].filter(isMemoryEntry) : [];
    const skills = Array.isArray(raw['skills']) ? raw['skills'].filter(isSkill) : [];
    const hooks = Array.isArray(raw['hooks']) ? raw['hooks'].filter(isHook) : [];
    const rawSubagents = Array.isArray(raw['subagents']) ? raw['subagents'].filter(isSubagent) : [];
    const subagents = rawSubagents.length > 0 ? rawSubagents : defaults.subagents;
    const mcpServers = Array.isArray(raw['mcpServers']) ? raw['mcpServers'].filter(isMcpServer) : [];
    const browsingEnabled = typeof raw['browsingEnabled'] === 'boolean' ? raw['browsingEnabled'] : true;
    return {
      workingDirectory,
      permissionMode,
      providers: decryptProviders(providers, crypto),
      onboardingDone,
      commands,
      memory,
      skills,
      hooks,
      subagents,
      mcpServers,
      browsingEnabled
    };
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
    onboardingDone: typeof patch.onboardingDone === 'boolean' ? patch.onboardingDone : current.onboardingDone,
    commands: Array.isArray(patch.commands) ? patch.commands.filter(isCommand) : current.commands,
    memory: Array.isArray(patch.memory) ? patch.memory.filter(isMemoryEntry) : current.memory,
    skills: Array.isArray(patch.skills) ? patch.skills.filter(isSkill) : current.skills,
    hooks: Array.isArray(patch.hooks) ? patch.hooks.filter(isHook) : current.hooks,
    subagents: Array.isArray(patch.subagents) ? patch.subagents.filter(isSubagent) : current.subagents,
    mcpServers: Array.isArray(patch.mcpServers) ? patch.mcpServers.filter(isMcpServer) : current.mcpServers,
    browsingEnabled: typeof patch.browsingEnabled === 'boolean' ? patch.browsingEnabled : current.browsingEnabled
  };
  const persisted: AppSettings = { ...next, providers: encryptProviders(next.providers, crypto) };
  writeFileSync(file, JSON.stringify(persisted, null, 2), 'utf8');
  return next;
}
