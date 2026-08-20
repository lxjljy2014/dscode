import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// 经子路径出口导入运行时值：主进程外部化 @dscode/shared 后由 Node 直接加载，
// 主入口 index.ts 的目录 re-export（./types）在 Node ESM 下不可解析
import { DEFAULT_COMMANDS, DEFAULT_SKILLS, DEFAULT_SUBAGENTS, DEEPSEEK_PRESET } from '@dscode/shared/settings';
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
 * 应用设置的 JSON 持久化（~/.dscode/config 目录，按域拆分）。
 * 工作目录、权限模式、AI 供应商配置与引导状态随应用重启保留。
 * 每个配置域一个 JSON 文件（general/providers/memory/skills/commands/hooks/subagents/mcp），
 * 便于用户按域编辑与备份；旧版单文件 settings.json 首次加载时自动迁移为拆分文件。
 * 通过可选 crypto 钩子支持 apiKey 静态加密（Electron safeStorage 由 desktop 层注入，core 保持无 Electron 依赖）。
 */

/** 静态加密钩子：desktop 注入 safeStorage 实现；缺省则明文存储 */
export interface SettingsCrypto {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

/** 配置域 → 文件名 + 归属字段（providers 独立文件，便于 apiKey 加密管理） */
export const CONFIG_DOMAINS: ReadonlyArray<{ file: string; fields: (keyof AppSettings)[] }> = [
  {
    file: 'general.json',
    fields: ['workingDirectory', 'permissionMode', 'onboardingDone', 'browsingEnabled', 'autoCompact', 'autoCompactThreshold']
  },
  { file: 'providers.json', fields: ['providers'] },
  { file: 'memory.json', fields: ['memory'] },
  { file: 'skills.json', fields: ['skills'] },
  { file: 'commands.json', fields: ['commands'] },
  { file: 'hooks.json', fields: ['hooks'] },
  { file: 'subagents.json', fields: ['subagents'] },
  { file: 'mcp.json', fields: ['mcpServers'] }
];

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

/** 归一化命令：把旧数据的 builtin-compact（提示词模板）迁移为 action 命令 */
function normalizeCommands(commands: Command[]): Command[] {
  return commands.map(c =>
    c.id === 'builtin-compact' && c.action === undefined
      ? { ...c, action: 'compact' as const }
      : c
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

/** 单字段归一化：非法值回退 fallback（fallback 来自默认设置或当前值） */
function normalizeField(field: keyof AppSettings, value: unknown, fallback: unknown): unknown {
  switch (field) {
    case 'workingDirectory':
      return typeof value === 'string' ? value : fallback;
    case 'permissionMode':
      return isPermissionMode(value) ? value : fallback;
    case 'onboardingDone':
      return typeof value === 'boolean' ? value : fallback;
    case 'browsingEnabled':
      return typeof value === 'boolean' ? value : fallback;
    case 'autoCompact':
      return typeof value === 'boolean' ? value : fallback;
    case 'autoCompactThreshold':
      // 百分比收敛到 50–95：过低会频繁压缩，过高起不到保护作用
      return typeof value === 'number' && Number.isFinite(value)
        ? Math.min(95, Math.max(50, Math.round(value)))
        : fallback;
    case 'providers':
      return normalizeProviders(Array.isArray(value) ? value.filter(isProviderConfig) : (fallback as ProviderConfig[]));
    case 'memory':
      return Array.isArray(value) ? value.filter(isMemoryEntry) : fallback;
    case 'skills':
      // 文件缺失（undefined）回退内置技能；显式空数组尊重用户删除
      return Array.isArray(value) ? value.filter(isSkill) : fallback;
    case 'commands':
      return normalizeCommands(Array.isArray(value) ? value.filter(isCommand) : (fallback as Command[]));
    case 'hooks':
      return Array.isArray(value) ? value.filter(isHook) : fallback;
    case 'subagents': {
      // 与旧行为一致：用户清空子智能体列表时回退内置默认
      const list = Array.isArray(value) ? value.filter(isSubagent) : [];
      return list.length > 0 ? list : fallback;
    }
    case 'mcpServers':
      return Array.isArray(value) ? value.filter(isMcpServer) : fallback;
    default:
      return fallback;
  }
}

/** 读取 JSON 文件为对象（缺失/损坏返回空对象） */
function readJsonFile(file: string): Record<string, unknown> {
  try {
    if (!existsSync(file)) return {};
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 原子写 JSON（临时文件 + rename，避免进程崩溃留下半写文件） */
function writeJsonAtomic(file: string, data: unknown): void {
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, file);
}

export function defaultSettings(homeDir: string): AppSettings {
  return {
    workingDirectory: homeDir,
    permissionMode: 'confirm',
    providers: [],
    onboardingDone: false,
    commands: [...DEFAULT_COMMANDS],
    memory: [],
    skills: [...DEFAULT_SKILLS],
    hooks: [],
    subagents: [...DEFAULT_SUBAGENTS],
    mcpServers: [],
    browsingEnabled: true,
    autoCompact: true,
    autoCompactThreshold: 80
  };
}

/**
 * 旧版单文件迁移：config 目录下存在 settings.json 且尚无拆分文件时，
 * 读旧文件 → 按域归一化 → 写拆分文件 → 旧文件改名 .bak。
 * 幂等：迁移后 settings.json 消失，下次不再触发。
 */
function migrateLegacySettingsFile(configDir: string, homeDir: string): void {
  const legacy = join(configDir, 'settings.json');
  if (!existsSync(legacy)) return;
  if (CONFIG_DOMAINS.some(d => existsSync(join(configDir, d.file)))) return;
  try {
    const raw = readJsonFile(legacy);
    const defaults = defaultSettings(homeDir);
    for (const domain of CONFIG_DOMAINS) {
      const out: Record<string, unknown> = {};
      for (const field of domain.fields) {
        // 旧文件 providers 已加密，原样搬运到拆分文件（loadSettings 统一解密）
        out[field as string] = normalizeField(field, raw[field as string], defaults[field]);
      }
      writeJsonAtomic(join(configDir, domain.file), out);
    }
    renameSync(legacy, legacy + '.bak');
  } catch {
    // 旧文件损坏：忽略，各域走默认值
  }
}

/** 加载 + 归一化 + 解密：按域合并配置文件，非法字段回退默认值 */
export function loadSettings(configDir: string, homeDir: string, crypto?: SettingsCrypto): AppSettings {
  mkdirSync(configDir, { recursive: true });
  migrateLegacySettingsFile(configDir, homeDir);
  const defaults = defaultSettings(homeDir);
  const result: AppSettings = { ...defaults };
  for (const domain of CONFIG_DOMAINS) {
    const raw = readJsonFile(join(configDir, domain.file));
    for (const field of domain.fields) {
      (result as unknown as Record<string, unknown>)[field] = normalizeField(field, raw[field as string], defaults[field]);
    }
  }
  result.providers = decryptProviders(result.providers, crypto);
  return result;
}

/** 合并 patch、加密 apiKey 后按域落盘，返回最新设置（返回值为解密后的明文，供调用方使用） */
export function saveSettings(
  configDir: string,
  homeDir: string,
  patch: SettingsPatch,
  crypto?: SettingsCrypto
): AppSettings {
  mkdirSync(configDir, { recursive: true });
  const current = loadSettings(configDir, homeDir, crypto);
  const next: AppSettings = { ...current };
  const changed = new Set<keyof AppSettings>();
  for (const key of Object.keys(patch) as (keyof AppSettings)[]) {
    const value = (patch as Record<string, unknown>)[key];
    (next as unknown as Record<string, unknown>)[key] = normalizeField(key, value, current[key]);
    changed.add(key);
  }
  // 只写有变更的域文件（其他域不动，避免无谓写入）
  for (const domain of CONFIG_DOMAINS) {
    if (!domain.fields.some(f => changed.has(f))) continue;
    const out: Record<string, unknown> = {};
    for (const field of domain.fields) out[field as string] = next[field];
    if (out['providers'] !== undefined) {
      out['providers'] = encryptProviders(out['providers'] as ProviderConfig[], crypto);
    }
    writeJsonAtomic(join(configDir, domain.file), out);
  }
  return next;
}