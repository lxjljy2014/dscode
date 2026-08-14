/**
 * 权限模式（语义对齐参考项目的 configurable-gate）：
 * - confirm（变更前确认）：写/执行类工具发确认请求
 * - auto-edit（自动编辑）：写工具直接放行，执行（bash）仍需确认
 * - plan（计划模式）：写/执行一律拒绝，只读 + 出方案
 * - full-access（完全访问）：全部放行
 * 门控实现在 @dscode/core 的 gate（确认弹层提供 Codex 风格多选项：允许一次/本会话/总是+持久规则/拒绝/换方案，120s 超时自动拒绝）。
 */
export type PermissionMode = 'confirm' | 'auto-edit' | 'plan' | 'full-access';

/** AI 供应商配置（OpenAI 兼容接口） */
export interface ProviderConfig {
  /** 唯一标识（预置 'deepseek'，自定义用 uuid） */
  id: string;
  /** 供应商显示名 */
  name: string;
  /** 接口地址，如 https://api.deepseek.com */
  baseUrl: string;
  /** API key（明文存储，原型阶段） */
  apiKey: string;
  /** 模型列表（可增删） */
  models: string[];
  /** 模型适配器 id（对应 @dscode/core adapters 注册表；缺省回退 openai-compatible） */
  adapter?: string;
}

/** 用户自定义斜杠命令（/name 展开为 prompt） */
export interface Command {
  /** 唯一标识（uuid） */
  id: string;
  /** 命令名（不含前导 /） */
  name: string;
  /** 菜单展示用一句话说明 */
  description: string;
  /** 展开后的提示词模板 */
  prompt: string;
}

/** 长期记忆条目（注入系统提示词） */
export interface MemoryEntry {
  id: string;
  content: string;
}

/** 技能：注入系统提示词的可用能力说明，agent 按需调用 */
export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
}

/** 生命周期钩子触发时机 */
export type HookTrigger = 'session_start' | 'session_end' | 'tool_done';

/** 生命周期钩子：在触发时机执行一条 shell 命令 */
export interface Hook {
  id: string;
  name: string;
  trigger: HookTrigger;
  command: string;
}

/** 子智能体：可切换的专用 agent 人设（选定后以其 systemPrompt 运行） */
export interface Subagent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
}

/** MCP 服务器配置（stdio 传输） */
export interface McpServer {
  id: string;
  name: string;
  command: string;
  args: string[];
}

/** 插件：userData/plugins 下的 .mjs 模块，贡献斜杠命令（后续可扩展钩子/技能） */
export interface Plugin {
  id: string;
  name: string;
  description: string;
  /** 贡献的斜杠命令 */
  commands?: Command[];
}

export interface AppSettings {
  /** 工作目录（默认家目录） */
  workingDirectory: string;
  /** 权限模式（默认 confirm） */
  permissionMode: PermissionMode;
  /** AI 供应商配置列表 */
  providers: ProviderConfig[];
  /** 是否已完成引导（完成/跳过后为 true，避免每次启动都弹引导页） */
  onboardingDone: boolean;
  /** 用户自定义斜杠命令 */
  commands: Command[];
  /** 长期记忆条目 */
  memory: MemoryEntry[];
  /** 技能列表 */
  skills: Skill[];
  /** 生命周期钩子列表 */
  hooks: Hook[];
  /** 子智能体列表 */
  subagents: Subagent[];
  /** MCP 服务器列表 */
  mcpServers: McpServer[];
  /** 是否启用网页浏览工具（browse） */
  browsingEnabled: boolean;
  /** 「总是允许」审批规则（工具签名列表，确认弹层选择后写入；命中则不再询问） */
  approvalRules: string[];
}

/** DeepSeek 预置供应商：引导页在 providers 为空时预填（apiKey 留空待用户填写） */
export const DEEPSEEK_PRESET: ProviderConfig = {
  id: 'deepseek',
  name: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
  adapter: 'deepseek'
};

/** 内置默认子智能体：首次启动（无自定义）时预置 */
export const DEFAULT_SUBAGENTS: Subagent[] = [
  {
    id: 'code-review',
    name: '代码审查',
    description: '审查代码质量、潜在 bug 与安全隐患',
    systemPrompt:
      '你是资深代码审查员。审查用户指定的代码或变更，聚焦四类问题：正确性（bug、边界条件、竞态、空值）、安全（注入、越权、敏感信息泄露）、可维护性（命名、重复、复杂度、坏味道）、性能（不必要的开销）。按严重程度从高到低逐条列出问题，每条给出具体位置与修改建议。只审查与建议，不擅自改动代码。'
  },
  {
    id: 'test-writer',
    name: '测试',
    description: '编写与补充单元测试',
    systemPrompt:
      '你是测试工程师。为指定代码编写单元测试，覆盖正常路径、边界条件与错误路径。优先使用项目现有测试框架（vitest）与目录约定。测试要可读、彼此独立、稳定不依赖执行顺序。先阅读被测代码与已有测试，再补测试；若被测代码难以测试，可提出最小改造建议。'
  },
  {
    id: 'docs',
    name: '文档',
    description: '编写文档、注释与 README',
    systemPrompt:
      '你是技术文档工程师。为代码编写清晰的注释、README、使用说明与 API 文档。遵循项目现有注释语言（中文）与风格。文档面向不熟悉代码的读者：说明用途、用法、关键设计、注意事项与示例。只编写文档与注释，不改变业务逻辑。'
  },
  {
    id: 'security',
    name: '安全审计',
    description: '审计安全漏洞与攻击面',
    systemPrompt:
      '你是应用安全专家。审计代码的安全问题，包括：注入（SQL/命令/提示注入）、路径穿越、认证与授权缺陷、敏感信息泄露、不安全的依赖或默认配置、不安全的文件操作。按风险等级列出发现，说明利用场景与修复方案。只报告，不擅自修改。'
  },
  {
    id: 'debugger',
    name: '调试',
    description: '定位并修复 bug',
    systemPrompt:
      '你是调试专家。针对用户描述的问题，先复现并定位根因：阅读相关代码、查看错误信息与日志、必要时用工具搜索或加临时日志。定位到根因后再做最小化修复，并解释根因与修复逻辑。避免掩盖症状式的修补，也不要扩大改动范围。'
  }
];

/**
 * API key 校验结果（校验请求由主进程发起：渲染端 CSP default-src 'self' 不允许直连外部 API）。
 * unauthorized = key 无效；network = 网络/服务异常；invalid-args = 参数不合法。
 */
export type ProviderVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'unauthorized' | 'network' | 'invalid-args' };

export type SettingsPatch = Partial<AppSettings>;
