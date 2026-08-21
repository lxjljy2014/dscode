/**
 * 权限模式（语义对齐参考项目的 configurable-gate）：
 * - confirm（变更前确认）：写/执行类工具发确认请求
 * - auto-edit（自动编辑）：写工具直接放行，执行（bash）仍需确认
 * - plan（计划模式）：写/执行一律拒绝，只读 + 出方案
 * - full-access（完全访问）：全部放行
 * 门控实现在 @dscode/core 的 gate（确认卡片三选项：允许一次/本会话/拒绝，拒绝停止整个任务，120s 超时自动拒绝）。
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
  /**
   * 推理模式（DeepSeek thinking）：true=显式 thinking enabled，false=显式 disabled，缺省跟随供应商默认。
   * 与 reasoningEffort 的交互对齐官方 harness：off 强制 disabled，high/max 强制 enabled。
   */
  thinking?: boolean;
  /** 推理档位：off / high / max（DeepSeek reasoning_effort）；缺省跟随供应商默认 */
  reasoningEffort?: 'off' | 'high' | 'max';
  /** 单请求输出上限（tokens）；缺省不发（供应商默认）；DeepSeek 预置对齐官方 256K */
  maxTokens?: number;
  /** 模型上下文窗口（tokens）：用于上下文占用展示；DeepSeek 预置对齐官方 1M */
  contextWindow?: number;
}

/** 斜杠命令的内置动作：命中后直接执行真实操作（而非展开为提示词发送） */
export type CommandAction = 'permission' | 'plan' | 'model' | 'compact';

/** 用户自定义斜杠命令（/name 展开为 prompt） */
export interface Command {
  /** 唯一标识（uuid） */
  id: string;
  /** 命令名（不含前导 /） */
  name: string;
  /** 菜单展示用一句话说明 */
  description: string;
  /** 展开后的提示词模板（action 命令忽略此字段，仅作设置页说明） */
  prompt: string;
  /** 可选的输入提示（如 [<objective>|clear|edit <objective>]），命令卡片展示用；缺省无 */
  input?: string;
  /** 内置动作：命中后直接执行（切换权限/计划模式/模型），而非展开为提示词发送 */
  action?: CommandAction;
  /** 条目来源标记：'skill' 表示由可用技能合成的斜杠条目（运行时生成，不持久化到 commands） */
  kind?: 'skill';
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

/**
 * 子智能体：可切换的专用 agent 人设（选定后以其 systemPrompt 运行），
 * 也可作为 task 工具委派的子任务人设（model/allowedTools/maxTurns/writable 仅对子任务生效）。
 */
export interface Subagent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  /** 子任务使用的模型（缺省跟随主会话） */
  model?: string;
  /** 子任务允许的工具名（缺省按 writable 决定：只读集或按权限模式收敛的全集） */
  allowedTools?: string[];
  /** 子任务最大轮次（缺省 12） */
  maxTurns?: number;
  /**
   * 允许子任务修改文件/执行命令（缺省 false 只读）：
   * true 时工具面按父运行权限模式收敛（full-access=全部、auto-edit=+文件编辑、
   * confirm=仍只读——子任务无确认 UI，需审批的操作不暴露）；改动计入父会话 diff。
   */
  writable?: boolean;
}

/** MCP 服务器配置（stdio 传输） */
export interface McpServer {
  id: string;
  name: string;
  command: string;
  args: string[];
}

/** 插件：~/.dscode/plugins 下的 .mjs 模块，贡献斜杠命令（后续可扩展钩子/技能） */
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
  /** 上下文压力自动压缩：运行结束时占用达到阈值百分比自动压缩对话历史（默认开启） */
  autoCompact: boolean;
  /** 自动压缩阈值（占供应商上下文窗口的百分比，50–95，默认 80） */
  autoCompactThreshold: number;
}

/** DeepSeek 预置供应商：引导页在 providers 为空时预填（apiKey 留空待用户填写） */
export const DEEPSEEK_PRESET: ProviderConfig = {
  id: 'deepseek',
  name: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
  adapter: 'deepseek',
  // 对齐官方 harness 默认输出上限（v4 系列 256K，避免供应商默认过低限制长输出）
  maxTokens: 256000,
  // 对齐官方默认上下文窗口（v4 系列 1M）
  contextWindow: 1000000
};

/** 内置技能：首次启动（无自定义）时预置；系统提示词只注入目录（名称+一句话说明），
 * 模型判断任务与某技能相关时先调用 skill 工具加载完整指令再执行（借鉴官方 harness 的
 * 目录注入 + 按需加载设计：避免把全部指令塞进提示词，省 token 且提升指令相关性）。 */
export const DEFAULT_SKILLS: Skill[] = [
  {
    id: 'code-review',
    name: 'code-review',
    description: '系统性审查代码，输出分级问题清单与修改建议',
    instructions:
      '以资深审查员身份审查用户指定代码或改动。按严重程度从高到低逐条列出问题，每条含具体位置（文件+行号或片段）、问题类别与修改建议。覆盖四类：正确性（bug、边界条件、竞态、空值、资源泄漏）、安全（注入、越权、敏感信息泄露）、可维护性（命名、重复、复杂度、坏味道）、性能（不必要的开销、大对象）。只审查与建议，不擅自改动代码。'
  },
  {
    id: 'test-writing',
    name: 'test-writing',
    description: '按项目约定编写单元测试，覆盖正常/边界/错误路径',
    instructions:
      '为指定代码编写单元测试。先阅读被测代码与项目现有测试（测试框架、目录约定、命名风格），再动手。覆盖：正常路径、边界条件（空输入、极端值、溢出）、错误路径。测试要可读、彼此独立、不依赖执行顺序，避免过度 mock（优先真实依赖或最小桩）。若被测代码难以测试，可提出最小改造建议并说明理由。写完运行测试确认通过。'
  },
  {
    id: 'git-commit',
    name: 'git-commit',
    description: '审查改动后按仓库约定撰写规范的提交信息',
    instructions:
      '提交前先审查改动：用 git status/diff 确认只包含本任务相关文件，检查是否有调试残留、临时文件、敏感信息（密钥/令牌/路径泄露）。按仓库现有约定写提交信息（本仓库使用中文、类型前缀如 feat:/fix:/style:/docs:，单行主题 ≤72 字符 + 必要时正文说明为什么）。大改动拆分多个逻辑独立的提交。不要提交依赖产物、缓存或未跟踪的无关注入。'
  },
  {
    id: 'debugging',
    name: 'debugging',
    description: '按复现→定位→最小修复→验证的流程排查 bug',
    instructions:
      '排查 bug 遵循流程：1) 复现——拿到稳定复现步骤或最小示例，确认问题现象与触发条件；2) 定位——阅读相关代码与错误信息，用搜索/临时日志/断点缩小范围，二分定位到根因（先怀疑输入/状态/时序，再怀疑逻辑）；3) 修复——做最小化改动，只改根因不掩盖症状，解释根因与修复逻辑；4) 验证——运行相关测试与手动复现步骤确认修复且无回归。避免扩大改动范围，遇到不确定先问用户。'
  },
  {
    id: 'refactoring',
    name: 'refactoring',
    description: '在不改变行为的前提下渐进重构代码',
    instructions:
      '重构遵守「行为不变」原则：1) 动手前先理解现有行为，必要时为关键路径补测试作为安全网；2) 小步进行，每步一个可编译、可运行、可验证的改动，避免一次大改；3) 优先机械性安全的变换（重命名、提取函数、消除重复、调整结构），逐步推进；4) 每次改动后运行测试与编译确认无回归；5) 重构与功能改动分开，不混在同一批修改里。'
  },
  {
    id: 'docs-writing',
    name: 'docs-writing',
    description: '面向读者的注释、README 与 API 文档写作规范',
    instructions:
      '为代码编写注释与文档时面向不熟悉代码的读者：说明用途、用法、关键设计、注意事项与示例，而不是复述代码本身。遵循项目现有语言（本仓库注释/文档用中文）与风格。README 结构：项目是什么、快速开始、主要用法、配置项、常见问题。注释只写「为什么」和「契约」，不写显而易见的代码叙述。只编写文档与注释，不改变业务逻辑。'
  },
  {
    id: 'security-audit',
    name: 'security-audit',
    description: '审计代码的攻击面与安全漏洞，输出风险清单',
    instructions:
      '以安全专家身份审计指定代码。逐项排查：注入（SQL/命令/提示注入、路径穿越）、认证与授权缺陷、敏感信息泄露（硬编码密钥、日志打印凭据）、不安全的文件操作与默认配置、不安全的依赖版本。对每个发现给出：风险等级、利用场景、修复方案。只报告与建议，不擅自修改代码。'
  },
  {
    id: 'performance-tuning',
    name: 'performance-tuning',
    description: '先测量后优化，定位瓶颈并验证收益',
    instructions:
      '性能优化遵循「先测量，后优化」：1) 明确可量化目标（如 P95 延迟、内存峰值）与基准；2) 用分析工具或日志定位真正的瓶颈（不要凭直觉优化），常见瓶颈：重复计算、N+1 查询、大对象拷贝、阻塞主线程、不必要的 IO；3) 针对瓶颈做最小改动，保持可读性；4) 用与基准相同的方法复测，对比验证收益；5) 收益不明显的优化不要做，复杂度与收益要匹配。'
  }
];

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

/** 内置斜杠命令：对齐官方 Harness（DSH）的内置命令集，首次启动（无自定义）时预置，可编辑/删除。
 *  action 命令命中后直接执行真实操作（切换权限/计划模式/模型）；其余为提示词模板，
 *  /name 展开为 prompt 填入输入框，用户可在此基础上补充上下文再发送。 */
export const DEFAULT_COMMANDS: Command[] = [
  {
    id: 'builtin-compact',
    name: 'compact',
    description: '压缩较旧的对话历史',
    action: 'compact',
    prompt: '压缩较旧的对话历史，生成结构化检查点并替换旧消息。'
  },
  {
    id: 'builtin-goal',
    name: 'goal',
    description: '设置或查看长期任务的目标',
    input: '[<objective>|clear|edit <objective>|pause|resume]',
    prompt:
      '请为当前任务设定一个清晰、可度量的目标：说明要达成的结果、完成标准与关键步骤，并据此规划后续工作。'
  },
  {
    id: 'builtin-feedback',
    name: 'feedback',
    description: '记录本会话的反馈',
    input: '<text>',
    prompt: '请就本次会话的表现给出反馈：指出做得好的地方、存在的问题与改进建议。'
  },
  {
    id: 'builtin-plan',
    name: 'plan',
    description: '进入或退出计划模式',
    input: '[off|message]',
    action: 'plan',
    prompt: '进入计划模式（/plan off 退出）：只读分析并给出方案，经确认后再修改文件或执行命令。'
  },
  {
    id: 'builtin-permission',
    name: 'permission',
    description: '切换权限模式',
    input: '[confirm|auto-edit|plan|full-access]',
    action: 'permission',
    prompt: '切换权限模式：confirm（变更前确认）/ auto-edit（自动编辑）/ plan（计划）/ full-access（完全访问）。'
  },
  {
    id: 'builtin-model',
    name: 'model',
    description: '切换本会话使用的模型',
    input: '[<name>]',
    action: 'model',
    prompt: '切换本会话使用的模型；不带参数时列出当前模型与可用模型。'
  },
  {
    id: 'builtin-export',
    name: 'export',
    description: '将会话日志下载为 ZIP 归档',
    prompt: '请说明如何导出当前会话的日志（会话记录保存在 ~/.dscode/sessions 目录下）。'
  }
];

/**
 * API key 校验结果（校验请求由主进程发起：渲染端 CSP default-src 'self' 不允许直连外部 API）。
 * unauthorized = key 无效；network = 网络/服务异常；invalid-args = 参数不合法。
 */
export type ProviderVerifyResult = { ok: true } | { ok: false; reason: 'unauthorized' | 'network' | 'invalid-args' };

export type SettingsPatch = Partial<AppSettings>;