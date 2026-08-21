import type {
  AgentToolName,
  ChatMessagePayload,
  ConfirmDecision,
  DiffFile,
  PermissionMode,
  ProviderConfig,
  SessionStats,
  Skill,
  Subagent
} from '@dscode/shared';
import { ApiError, resolveAdapter, streamChatWithRetry } from '../adapters';
import type { ChatUsage } from '../adapters/types';
import type { LlmCache } from '../cache/llm-cache';
import { isConfirmDecision } from '../gate/gate';
import { TOOLS, toolSchemas } from '../tools';
import type { Tool, ToolContext } from '../tools';
import type { SubagentTaskRequest, SubagentTaskResult } from '../tools/types';
import { DiffSnapshotStore } from '../workspace/diff';
import { estimateMessageTokens, estimateSystemTokens, estimateTokens, estimateToolsTokens } from './token-estimate';
import { executeToolBatch } from './tool-batch';
import type { AgentEventSink } from './types';

/**
 * agent 运行时：执行「LLM 流式对话 + 工具循环」，与宿主解耦（事件经 AgentEventSink 上抛）。
 * 会话按 sessionId 管理；配置（供应商/工作目录/权限模式）由宿主读自己的持久化后传入，
 * 渲染端不可注入 baseUrl/key。
 */

const MAX_TOOL_ROUNDS = 30;
/** 单次运行注入上下文的工具结果总字符预算：封顶最坏情况输出，防上下文无界增长 */
const MAX_TOOL_CONTEXT_CHARS = 200_000;
/** 单轮 LLM 请求最长等待（含流式全程） */
const ROUND_TIMEOUT_MS = 5 * 60_000;

/**
 * 会话级缓存（运行统计 / 本会话免问放行）条目上限：超过按 LRU 淘汰最旧
 * （Map 插入序即 LRU 序，start 时刷新新鲜度），防主进程长生命周期下两个 Map 只增不减。
 */
const MAX_SESSION_CACHE_ENTRIES = 64;

/** 子任务（task 工具派发）相关约束 */
/** 单次父运行内子任务次数上限（防无界派生烧 token） */
const MAX_SUBTASKS_PER_RUN = 5;
/** 子任务默认轮数上限 */
const DEFAULT_SUBAGENT_MAX_TURNS = 12;
/** 子任务结论返回主上下文的字符上限 */
const SUBAGENT_RESULT_MAX_CHARS = 8 * 1024;
/** 子任务默认工具集（只读；不含 task 防递归委派） */
const SUBAGENT_DEFAULT_TOOLS: readonly string[] = ['read_file', 'list_dir', 'search', 'browse'];

/** 子任务默认人设（task 工具未指定 subagent 时使用） */
const SUBAGENT_DEFAULT_PROMPT = `你是被主任务派发的子任务执行者，在用户的工作目录中完成给定的只读调查任务。规则：
- 只使用只读工具（读文件/列目录/搜索/浏览），不要尝试修改任何文件
- 聚焦完成给定任务，不扩大范围
- 完成后输出简明结论（要点式，附关键文件路径与证据）——这是主任务唯一能看到的内容`;

/** 运行时已解析的供应商请求参数（主运行与子任务共用） */
interface ResolvedProvider {
  baseUrl: string;
  apiKey: string;
  adapter?: string;
  thinking?: boolean;
  reasoningEffort?: 'off' | 'high' | 'max';
  maxTokens?: number;
}

/** runLoop 可选项：主运行全量暴露工具；子任务注入白名单与更小轮数上限 */
interface RunLoopOptions {
  browsingEnabled: boolean;
  skills: Skill[];
  sink: AgentEventSink;
  llmCache?: LlmCache;
  /** MCP 动态工具（主运行注入；子任务缺省不注入） */
  mcpTools?: Tool[];
  /** 工具白名单（子任务）：schema 与执行双重过滤，task 始终排除；缺省全量 */
  allowedTools?: Set<string>;
  /** 轮数上限（缺省 MAX_TOOL_ROUNDS；子任务更小） */
  maxRounds?: number;
  /** 子任务派发实现（主运行注入，task 工具用） */
  spawnSubagent?: ToolContext['spawnSubagent'];
}

/** 系统提示词：默认值，可经 AgentStartInput.config.systemPrompt 覆盖 */
export const SYSTEM_PROMPT = `你是 DSCode 内置的编程助手，在用户的工作目录中工作。可以调用工具读取文件、列出目录、搜索代码、执行命令、写入或编辑文件。规则：
- 修改代码前先阅读相关文件，理解上下文
- 写文件/编辑/执行命令会经过系统权限门控，可能需要用户确认
- 工作目录内的路径一律使用相对路径
- 回答语言与用户提问一致
- 只做用户要求的事，不擅自扩大改动范围`;

/** 英文系统提示词（非中文环境使用，语义与 SYSTEM_PROMPT 一致） */
export const SYSTEM_PROMPT_EN = `You are DSCode's built-in coding assistant, working in the user's working directory. You can call tools to read files, list directories, search code, run commands, and write or edit files. Rules:
- Read relevant files to understand context before modifying code
- Writing/editing files and running commands go through the system permission gate and may require user confirmation
- Use relative paths within the working directory
- Reply in the same language as the user
- Only do what the user asked; don't expand the scope of changes`;

// approvalSignature 已移至 tools/index.ts（与工具注册表同域，避免 tool-batch ↔ runtime 循环依赖）
export { approvalSignature } from '../tools';

interface RunState {
  controller: AbortController;
  /** 已被新运行替换：中止时不再向渲染端推 aborted 事件（渲染端状态已丢失，推了也无接收方） */
  replacing: boolean;
  /** runLoop 收尾完成（含 finally 清理），替换时等待旧运行完全退出 */
  done: Promise<void>;
}

/** 等待用户确认的工具调用：toolEventId → 归属会话 + resolve（决策由确认弹层多选项给出） */
interface PendingConfirm {
  sessionId: string;
  resolve: (decision: ConfirmDecision) => void;
}

/** 启动一次 agent 运行所需的输入（公共边界强类型，宿主在 IPC 边界完成校验） */
export interface AgentStartInput {
  sessionId: string;
  model: string;
  rawMessages: ChatMessagePayload[];
  /**
   * 会话累计运行统计起点（宿主从持久化读回）：重启后启动新运行时回灌，
   * 让轮次/token/上下文占用（contextTokens）等累计值继续累积，而不是从零清零。
   */
  initialStats?: SessionStats;
  /** 事件接收方（宿主实现） */
  sink: AgentEventSink;
  /** 运行配置：宿主读自己的持久化后传入 */
  config: {
    workingDirectory: string;
    /**
     * 权限模式启动快照：agent 启动时读到的值，作为整轮运行的兜底。
     * 运行中切换权限模式默认不生效（本轮固定用此快照）。
     */
    permissionMode: PermissionMode;
    /**
     * 动态权限模式源（可选）：每次工具轮询前经此解析「当前」权限模式。
     * 提供后，运行中在输入卡片切换权限模式，下一轮工具调用立即按新模式门控；
     * 缺省回退启动快照（旧行为：本轮固定）。
     */
    permissionModeSource?: () => PermissionMode | Promise<PermissionMode>;
    providers: ProviderConfig[];
    systemPrompt?: string;
    /** 是否启用网页浏览（browse 工具）；默认启用 */
    browsingEnabled?: boolean;
    /** 可用技能列表（系统提示词注入目录，skill 工具按名加载正文；缺省空列表不暴露 skill 工具） */
    skills?: Skill[];
    /** 子智能体配置（task 工具按名/id 解析人设与工具集；缺省空列表走通用探索者） */
    subagents?: Subagent[];
    /** LLM 回复缓存（省成本；命中时重放缓存响应，不调 API） */
    llmCache?: LlmCache;
    /**
     * 动态注入的 MCP 工具（宿主经 buildMcpTools 构建后传入）：
     * 与内置工具并行暴露给模型，执行经 MCP 连接池；权限默认 write（走确认门控）。
     */
    mcpTools?: Tool[];
    /**
     * DeepSeek 推理模式覆盖（缺省读第一个 provider 的配置）：
     * true=thinking enabled，false=disabled，undefined=跟随 provider/供应商默认
     */
    thinking?: boolean;
    reasoningEffort?: 'off' | 'high' | 'max';
    /** 单请求输出上限（tokens）；缺省读 provider.maxTokens，再缺省不发 */
    maxTokens?: number;
  };
}

export type AgentStartResult = { ok: true } | { ok: false; error: 'already-running' | 'no-models' | 'invalid-args' };

/**
 * 运行时状态封装成实例：runs / pendingConfirms / diff 快照均按实例隔离，
 * 支持多实例并发与单测（模块级全局单例会导致跨会话串扰、且 DB/快照不可复用于多库/多窗口）。
 */
export class AgentRuntime {
  private runs = new Map<string, RunState>();
  private pendingConfirms = new Map<string, PendingConfirm>();
  private snapshots = new DiffSnapshotStore();
  private toolSeq = 0;
  /** 本会话免问：sessionId → 已放行的工具签名集合 */
  private sessionApprovals = new Map<string, Set<string>>();
  /** 会话级运行统计（输入卡片下方统计条；跨多次运行累计，每次运行结束推送全量） */
  private sessionStats = new Map<string, SessionStats>();

  private nextToolId(): string {
    return `t-${Date.now()}-${this.toolSeq++}`;
  }

  /** 会话级缓存 LRU：刷新本会话新鲜度，超出上限按插入序淘汰最旧条目 */
  private touchSessionCache<K, V>(map: Map<K, V>, key: K): void {
    const cached = map.get(key);
    if (cached !== undefined) {
      map.delete(key);
      map.set(key, cached);
    }
    while (map.size > MAX_SESSION_CACHE_ENTRIES) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }

  /** 会话统计空值起点（跨运行累计） */
  private statsEntry(sessionId: string): SessionStats {
    let s = this.sessionStats.get(sessionId);
    if (!s) {
      s = {
        rounds: 0,
        llmMs: 0,
        toolMs: 0,
        firstTokenMsSum: 0,
        firstTokenCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        cacheHits: 0,
        cacheMisses: 0,
        cacheHitTokens: 0,
        cacheMissTokens: 0
      };
      this.sessionStats.set(sessionId, s);
    }
    return s;
  }

  /** 启动一次 agent 运行（同会话已在运行则先中止旧运行再启动，适配渲染端状态丢失后的重发） */
  async start(input: AgentStartInput): Promise<AgentStartResult> {
    const { sessionId, model, rawMessages, sink, config, initialStats } = input;

    // 先做输入校验，避免非法输入中止正在进行的运行
    // 按 model 反查所属供应商（多供应商：模型名跨供应商定位，不再静默回退到 providers[0] 造成配置被忽略）
    const provider =
      (model.length > 0 ? config.providers.find(p => p.models.includes(model)) : undefined) ?? config.providers[0];
    if (!provider || provider.apiKey.length === 0) {
      sink.error(sessionId, 'no-api-key');
      return { ok: true };
    }
    const resolvedModel = provider.models.includes(model) ? model : (provider.models[0] ?? '');
    if (resolvedModel.length === 0) return { ok: false, error: 'no-models' };

    // 同会话重发（窗口重载/重开后渲染端状态丢失）：标记替换、中止并等待旧运行完全退出
    const existing = this.runs.get(sessionId);
    if (existing) {
      existing.replacing = true;
      existing.controller.abort();
      await existing.done.catch(() => {});
    }

    const controller = new AbortController();
    const run: RunState = { controller, replacing: false, done: Promise.resolve() };
    this.runs.set(sessionId, run);
    // 会话级缓存 LRU：本会话刷新为最新，超出上限淘汰最旧条目
    this.touchSessionCache(this.sessionApprovals, sessionId);
    this.touchSessionCache(this.sessionStats, sessionId);
    // 重启后回灌持久化的会话统计作为累计起点：轮次/token/上下文占用不再被清零
    if (initialStats && !this.sessionStats.has(sessionId)) {
      this.sessionStats.set(sessionId, { ...initialStats });
    }
    // agent 启动时快照工作目录，作为本次运行 diff 的基线
    await this.snapshots.initSnapshot(sessionId, config.workingDirectory);

    const context: unknown[] = [
      { role: 'system', content: config.systemPrompt ?? SYSTEM_PROMPT },
      // 原样透传渲染端重建的历史（user/assistant tool_calls/tool 结果），
      // 与运行时 loop 内 push 的消息结构一致，保证跨运行请求前缀字节级稳定
      ...rawMessages
    ];

    // 子任务派发计数（单次父运行内；task 工具经 spawnSubagent 闭包使用）
    let subtaskCount = 0;
    // 本次运行的供应商请求参数（主循环与子任务共用）
    const resolved: ResolvedProvider = {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      adapter: provider.adapter,
      thinking: config.thinking ?? provider.thinking,
      reasoningEffort: config.reasoningEffort ?? provider.reasoningEffort,
      maxTokens: config.maxTokens ?? provider.maxTokens
    };
    // 子任务派发环境：捕获父运行配置，供 task 工具 spawn 独立上下文的只读子运行
    const subagentEnv = {
      workingDirectory: config.workingDirectory,
      providers: config.providers,
      browsingEnabled: config.browsingEnabled !== false,
      llmCache: config.llmCache,
      subagents: config.subagents ?? []
    };

    run.done = this.runLoop(
      sessionId,
      config.workingDirectory,
      config.permissionMode,
      config.permissionModeSource,
      resolved,
      resolvedModel,
      context,
      {
        browsingEnabled: config.browsingEnabled !== false,
        skills: config.skills ?? [],
        sink,
        llmCache: config.llmCache,
        mcpTools: config.mcpTools,
        // task 工具的派发实现：继承父运行环境，父取消信号联动子运行
        spawnSubagent: (req, toolSignal) =>
          this.runSubagentTask(
            sessionId,
            subagentEnv,
            resolved,
            resolvedModel,
            () => subtaskCount++,
            req,
            toolSignal ?? run.controller.signal
          )
      }
    ).finally(() => {
      if (this.runs.get(sessionId) === run) this.runs.delete(sessionId);
      // 快照保留（下一次运行启动时覆盖）：DiffPanel 的「恢复到运行前」依赖它；
      // 内存占用由 MAX_SESSION_SNAPSHOTS 淘汰最旧兜底
      // 运行结束未处理的确认一律视为拒绝，仅清理本会话，避免误伤其它会话
      for (const [id, c] of this.pendingConfirms) {
        if (c.sessionId === sessionId) {
          c.resolve({ kind: 'deny' });
          this.pendingConfirms.delete(id);
        }
      }
    });
    return { ok: true };
  }

  // ---- agent 循环 ----

  /**
   * 执行一次子任务（task 工具派发）：以独立 sessionId 与独立上下文窗口运行只读工具循环，
   * 静默 sink 收集全部正文流，结束后仅把结论文本返回给父运行的 task 工具结果。
   * 安全约束：工具白名单（缺省只读集，task 始终排除防递归）、轮数上限、单父运行次数上限、
   * 父/task 取消信号联动子运行；子任务不触发确认（只读工具全模式放行，异常确认直接拒绝）。
   */
  private async runSubagentTask(
    parentSessionId: string,
    env: {
      workingDirectory: string;
      providers: ProviderConfig[];
      browsingEnabled: boolean;
      llmCache?: LlmCache;
      subagents: Subagent[];
    },
    parentProvider: ResolvedProvider,
    parentModel: string,
    nextSubtaskCount: () => number,
    req: SubagentTaskRequest,
    signal: AbortSignal
  ): Promise<SubagentTaskResult> {
    // 次数上限（闭包计数父运行生命周期内累计；调用即自增，返回本次序号）
    const used = nextSubtaskCount();
    if (used >= MAX_SUBTASKS_PER_RUN) {
      return { ok: false, content: `子任务次数已达上限（${MAX_SUBTASKS_PER_RUN} 次），请直接在主任务中完成` };
    }

    // 子智能体解析：id 或 name 匹配；未匹配（或未指定）走默认探索者人设
    const conf = req.subagent ? env.subagents.find(s => s.id === req.subagent || s.name === req.subagent) : undefined;
    const systemPrompt = conf?.systemPrompt ?? SUBAGENT_DEFAULT_PROMPT;

    // 模型：子智能体配置的 model 反查供应商（找不到回退父运行的）
    let provider = parentProvider;
    let model = parentModel;
    if (conf?.model) {
      const found = env.providers.find(p => p.models.includes(conf.model!));
      if (found) {
        provider = {
          baseUrl: found.baseUrl,
          apiKey: found.apiKey,
          adapter: found.adapter,
          thinking: found.thinking,
          reasoningEffort: found.reasoningEffort,
          maxTokens: found.maxTokens
        };
        model = conf.model;
      }
    }

    // 工具白名单：配置集（缺省只读集）∩ 真实存在的内置工具，排除 task（防递归）
    const configured = conf?.allowedTools && conf.allowedTools.length > 0 ? conf.allowedTools : SUBAGENT_DEFAULT_TOOLS;
    const allowedTools = new Set(configured.filter(n => n !== 'task' && n in TOOLS));
    if (allowedTools.size === 0) allowedTools.add('read_file'); // 兜底：白名单清空时至少可读

    // 子运行注册（获得 runs Map 的 abort 语义）与父取消联动
    const subSessionId = `${parentSessionId}#sub-${used}`;
    const subController = new AbortController();
    const subRun: RunState = { controller: subController, replacing: false, done: Promise.resolve() };
    this.runs.set(subSessionId, subRun);
    const onParentAbort = (): void => subController.abort();
    signal.addEventListener('abort', onParentAbort, { once: true });

    // 静默 sink：只收集正文流与终态，不向渲染端上抛（子任务过程不进聊天流）
    let collected = '';
    let failure = '';
    const subSink: AgentEventSink = {
      delta: (_sid, kind, content) => {
        if (kind === 'content') collected += content;
      },
      tool: () => {},
      confirm: (_sid, toolEventId) => {
        // 只读工具不应触发确认；防御性拒绝（外部确认也无 UI 入口）
        this.resolveConfirm(toolEventId, { kind: 'deny' });
      },
      usage: () => {},
      done: () => {},
      error: (_sid, code, detail) => {
        failure = detail ? `${code}: ${detail}` : code;
      },
      sessionStats: () => {},
      context: () => {},
      diff: () => {}
    };

    try {
      await this.runLoop(subSessionId, env.workingDirectory, 'confirm', undefined, provider, model, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: req.prompt }
      ], {
        browsingEnabled: env.browsingEnabled,
        skills: [],
        sink: subSink,
        llmCache: env.llmCache,
        allowedTools,
        maxRounds: conf?.maxTurns ?? DEFAULT_SUBAGENT_MAX_TURNS
      });
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    } finally {
      signal.removeEventListener('abort', onParentAbort);
    }

    if (signal.aborted || subController.signal.aborted) return { ok: false, content: '子任务已中止' };
    if (failure) return { ok: false, content: `子任务失败：${failure}` };
    const conclusion = collected.trim().slice(0, SUBAGENT_RESULT_MAX_CHARS);
    return { ok: true, content: conclusion.length > 0 ? conclusion : '（子任务未返回结论）' };
  }

  private async runLoop(
    sessionId: string,
    cwd: string,
    permissionMode: PermissionMode,
    permissionModeSource: (() => PermissionMode | Promise<PermissionMode>) | undefined,
    provider: ResolvedProvider,
    model: string,
    messages: unknown[],
    opts: RunLoopOptions
  ): Promise<void> {
    const run = this.runs.get(sessionId);
    if (!run) return;
    const signal = run.controller.signal;
    // 局部别名：函数体内沿用既有标识符（skills/sink/llmCache）
    const { skills, sink, llmCache } = opts;
    // 动态工具查表（executeTool 内置注册表未命中时回退到此）
    const extraTools = new Map<string, Tool>((opts.mcpTools ?? []).map(t => [t.name, t]));
    // 轮数上限（子任务更小）
    const maxRounds = opts.maxRounds ?? MAX_TOOL_ROUNDS;

    try {
      let totalPrompt = 0;
      let totalCompletion = 0;
      // API 前缀缓存命中的输入 token 累计（DeepSeek 上下文缓存；随前缀稳定而升高，随 usage 事件落库）
      let totalCachedPrompt = 0;
      // 本运行的工具结果上下文预算（跨轮累计，executeToolBatch 在插入时按预算截断）
      const toolBudget = { remaining: MAX_TOOL_CONTEXT_CHARS };
      // 工具 schema 跨轮不变（browsingEnabled/skills 固定），提升到循环外供上下文投影复用；
      // MCP 动态工具一并注入（与内置工具并行暴露）；子任务按白名单收敛工具面
      let tools = toolSchemas(opts.browsingEnabled, false, opts.skills.length > 0, opts.mcpTools);
      if (opts.allowedTools) {
        const allowed = opts.allowedTools;
        tools = tools.filter(t => allowed.has((t as { function: { name: string } }).function.name));
      }
      // ---- 上下文占用投影（借鉴官方 harness token-meter 的 anchored projection）----
      // 锚定供应商最近一次 usage 的 promptTokens，叠加「表面」启发式增量，让占用随流式正文/工具结果
      // 实时更新，而不是等本轮 usage 到达后才统计。表面 = 系统提示词 + 工具 schema + 对话消息 + 流式累计。
      const CONTEXT_PUSH_INTERVAL_MS = 250;
      const persistedStats = this.statsEntry(sessionId);
      let anchoredPromptTokens = persistedStats.contextTokens ?? 0;
      let streamingContent = '';
      let streamingReasoning = '';
      let lastContextPush = 0;
      const computeBreakdown = (): { systemTokens: number; toolsTokens: number; messagesTokens: number } => {
        const systemContent = (messages[0] as { content?: string } | undefined)?.content ?? '';
        const systemTokens = estimateSystemTokens(systemContent);
        const toolsTokens = estimateToolsTokens(tools);
        let messagesTokens = 0;
        for (const m of messages.slice(1)) messagesTokens += estimateMessageTokens(m);
        messagesTokens += estimateTokens(streamingContent) + estimateTokens(streamingReasoning);
        return { systemTokens, toolsTokens, messagesTokens };
      };
      const surfaceTokens = (b: { systemTokens: number; toolsTokens: number; messagesTokens: number }): number =>
        b.systemTokens + b.toolsTokens + b.messagesTokens;
      // 有历史锚点时采样当前表面（投影从准确值起步）；无历史时采样 0（投影退化为纯启发式）
      let sampledSurfaceTokens = anchoredPromptTokens > 0 ? surfaceTokens(computeBreakdown()) : 0;
      const pushContext = (): void => {
        const b = computeBreakdown();
        const contextTokens = Math.max(0, anchoredPromptTokens + (surfaceTokens(b) - sampledSurfaceTokens));
        sink.context(sessionId, { contextTokens, ...b });
      };
      const maybePushContext = (): void => {
        const now = Date.now();
        if (now - lastContextPush < CONTEXT_PUSH_INTERVAL_MS) return;
        lastContextPush = now;
        pushContext();
      };
      pushContext(); // 初始投影：锚定持久化占用（无历史时为纯启发式）
      for (let round = 0; round < maxRounds; round++) {
        const combined = AbortSignal.any([signal, AbortSignal.timeout(ROUND_TIMEOUT_MS)]);
        const roundStart = Date.now();
        // 首 token 耗时（首个非空正文增量；缓存命中轮保持 null 不计数）
        let firstTokenMs: number | null = null;
        // 一次 LLM 请求（聚合流式文本，供缓存写入）；瞬时故障（429/5xx/网络）指数退避重试，
        // 借鉴官方 harness llm-retry（可取消退避 + jitter，中止/超时不重试）
        // 每轮重置流式累计：上一轮推理/正文已在 assistant 消息入上下文（见下方 messages.push）
        streamingContent = '';
        streamingReasoning = '';
        const requestOnce = async (): Promise<{
          toolCalls: { id: string; name: AgentToolName; arguments: string }[];
          usage?: ChatUsage;
          content: string;
          reasoning: string;
        }> => {
          let contentBuf = '';
          let reasoningBuf = '';
          const res = await streamChatWithRetry(
            resolveAdapter(provider.adapter),
            {
              baseUrl: provider.baseUrl,
              apiKey: provider.apiKey,
              model,
              messages,
              tools,
              thinking: provider.thinking,
              reasoningEffort: provider.reasoningEffort,
              maxTokens: provider.maxTokens
            },
            combined,
            text => {
              if (firstTokenMs === null && text.length > 0) firstTokenMs = Date.now() - roundStart;
              contentBuf += text;
              streamingContent += text;
              sink.delta(sessionId, 'content', text);
              maybePushContext();
            },
            text => {
              reasoningBuf += text;
              streamingReasoning += text;
              sink.delta(sessionId, 'reasoning', text);
              maybePushContext();
            }
          );
          return { toolCalls: res.toolCalls, usage: res.usage, content: contentBuf, reasoning: reasoningBuf };
        };

        // LLM 回复缓存：命中则重放（文本/思维链按流式推送，工具调用进入正常循环），不调 API
        let toolCalls: { id: string; name: AgentToolName; arguments: string }[];
        let usage: ChatUsage | undefined;
        let cacheHit = false;
        // 本轮思维链：入 assistant 上下文做 thinking passback（DeepSeek 规则：工具调用回合必须回传 reasoning_content）
        let reasoning = '';
        if (llmCache) {
          const key = llmCache.key(model, messages, tools);
          const cached = await llmCache.get(key);
          if (cached) {
            cacheHit = true;
            // 命中不调用 API：节省量记入缓存统计，但真实用量为 0（不上报虚高的 tokens）
            await llmCache.recordHit(model, cached.promptTokens, cached.completionTokens);
            streamingReasoning = cached.reasoning ?? '';
            streamingContent = cached.content ?? '';
            if (cached.reasoning) sink.delta(sessionId, 'reasoning', cached.reasoning);
            if (cached.content) sink.delta(sessionId, 'content', cached.content);
            toolCalls = cached.toolCalls;
            reasoning = cached.reasoning ?? '';
            usage = undefined;
          } else {
            const res = await requestOnce();
            toolCalls = res.toolCalls;
            reasoning = res.reasoning;
            usage = res.usage;
            // 只缓存成功响应；异常（throw）时不会走到这里
            await llmCache.set(key, {
              content: res.content,
              reasoning: res.reasoning,
              toolCalls: res.toolCalls,
              promptTokens: res.usage?.promptTokens ?? 0,
              completionTokens: res.usage?.completionTokens ?? 0
            });
            // 未命中 = 本次请求成功且已缓存；失败请求不计入（避免重试污染命中率分母）
            await llmCache.recordMiss(model);
          }
        } else {
          const res = await requestOnce();
          toolCalls = res.toolCalls;
          reasoning = res.reasoning;
          usage = res.usage;
        }
        if (usage) {
          totalPrompt += usage.promptTokens;
          totalCompletion += usage.completionTokens;
          totalCachedPrompt += usage.cachedPromptTokens ?? 0;
        }
        // 会话统计累计（每轮：LLM 耗时/首 token/tokens/缓存命中）
        const s = this.statsEntry(sessionId);
        s.rounds += 1;
        s.llmMs += Date.now() - roundStart;
        if (firstTokenMs !== null) {
          s.firstTokenMsSum += firstTokenMs;
          s.firstTokenCount += 1;
        }
        s.promptTokens += usage?.promptTokens ?? 0;
        s.completionTokens += usage?.completionTokens ?? 0;
        // 前缀缓存（API 侧 context caching）：cached 部分打折计费，未命中部分全价
        s.cacheHitTokens += usage?.cachedPromptTokens ?? 0;
        s.cacheMissTokens += (usage?.promptTokens ?? 0) - (usage?.cachedPromptTokens ?? 0);
        // 当前上下文占用：最近一轮请求的完整 prompt 大小（含缓存命中，与官方 pressureTokens 语义一致）；
        // 缓存命中轮不调 API（usage 缺省），上下文未变，沿用上轮值
        if (usage) {
          s.contextTokens = usage.promptTokens;
          // 锚定投影：本轮准确 prompt 入锚，采样当前表面；之后表面增量（工具结果等）实时叠加到投影
          anchoredPromptTokens = usage.promptTokens;
          sampledSurfaceTokens = surfaceTokens(computeBreakdown());
          // 上下文构成估算：把准确的 promptTokens 按启发式构成占比拆分（非精确计费；messages 补齐使总和 = contextTokens）。
          // 不含流式累计——流式是本次请求的输出，不是本次请求的输入构成。
          const systemContent = (messages[0] as { content?: string } | undefined)?.content ?? '';
          const rawSystem = estimateSystemTokens(systemContent);
          const rawTools = estimateToolsTokens(tools);
          let rawMessages = 0;
          for (const m of messages.slice(1)) rawMessages += estimateMessageTokens(m);
          const rawTotal = rawSystem + rawTools + rawMessages;
          if (rawTotal > 0) {
            s.systemTokens = Math.round((usage.promptTokens * rawSystem) / rawTotal);
            s.toolsTokens = Math.round((usage.promptTokens * rawTools) / rawTotal);
            s.messagesTokens = usage.promptTokens - s.systemTokens - s.toolsTokens;
          }
        }
        if (cacheHit) s.cacheHits += 1;
        else s.cacheMisses += 1;
        if (toolCalls.length === 0) {
          sink.usage(sessionId, { promptTokens: totalPrompt, completionTokens: totalCompletion, cachedPromptTokens: totalCachedPrompt });
          sink.done(sessionId);
          return;
        }

        // 本轮 assistant 消息（含文本与工具调用）入上下文；
        // reasoning_content 仅工具调用回合回传（DeepSeek thinking passback），纯文本回合不带省 token
        messages.push({
          role: 'assistant',
          content: '',
          ...(reasoning.length > 0 ? { reasoning_content: reasoning } : {}),
          tool_calls: toolCalls.map(t => ({
            id: t.id,
            type: 'function',
            function: { name: t.name, arguments: t.arguments }
          }))
        });
        // 本轮 reasoning/正文已入 assistant 消息（reasoning_content），清空流式累计避免与 messages 重复计价
        streamingReasoning = '';
        streamingContent = '';

        // 调度本轮工具调用：门控串行确认 → 并行滚动池/独占屏障 → 模型顺序提交（借鉴官方 harness tool-calls 调度）。
        // 每次轮询前经 permissionModeSource 解析最新权限模式：运行中切换，下一轮工具立即按新模式门控（缺省用启动快照）
        const effectivePermissionMode = permissionModeSource
          ? await permissionModeSource()
          : permissionMode;
        if (signal.aborted) return;
        const outcome = await executeToolBatch(
          sessionId,
          effectivePermissionMode,
          toolCalls,
          messages,
          cwd,
          signal,
          sink,
          {
            nextToolId: () => this.nextToolId(),
            addToolMs: (sid, ms) => { this.statsEntry(sid).toolMs += ms; },
            sessionApprovals: this.sessionApprovals,
            pendingConfirms: this.pendingConfirms,
            abortRun: sid => { run.controller.abort(); void sid; },
            recomputeDiff: (sid, wd, changedPaths) => this.snapshots.recomputeDiff(sid, wd, changedPaths).then(files => { sink.diff(sid, files); }),
            toolBudget,
            skills,
            extraTools,
            ...(opts.allowedTools ? { allowedTools: opts.allowedTools } : {}),
            ...(opts.spawnSubagent ? { spawnSubagent: opts.spawnSubagent } : {}),
          }
        );
        // 工具结果已入上下文：表面增长，推送实时投影
        pushContext();
        if (!outcome.continueLoop) return;
        // 工具标记本轮结束（concludesTurn）：本轮不再回模型，直接完成运行
        if (outcome.concluded) {
          sink.usage(sessionId, { promptTokens: totalPrompt, completionTokens: totalCompletion, cachedPromptTokens: totalCachedPrompt });
          sink.done(sessionId);
          return;
        }
      }
      // 工具循环打满 MAX_TOOL_ROUNDS 仍未产生最终回答：按错误收尾，避免「无结论却显示完成」误导用户
      sink.usage(sessionId, { promptTokens: totalPrompt, completionTokens: totalCompletion, cachedPromptTokens: totalCachedPrompt });
      sink.error(sessionId, 'max-rounds', `已达到最大工具轮次（${maxRounds} 轮），任务提前结束`);
    } catch (e) {
      if (signal.aborted) {
        // 被新运行替换时静默退出（渲染端已丢失状态，aborted 事件无接收方）
        if (!run.replacing) sink.error(sessionId, 'aborted');
        return;
      }
      if (e instanceof ApiError) {
        sink.error(sessionId, 'api', `HTTP ${e.status} ${e.message}`);
      } else if (e instanceof Error && e.name === 'TimeoutError') {
        sink.error(sessionId, 'network', '请求超时');
      } else {
        // 真正未知的异常（代码 bug 等）不再伪装成 network，便于排障
        sink.error(sessionId, 'unknown', e instanceof Error ? e.message : String(e));
      }
    } finally {
      // 运行结束（正常/错误/中止）推送会话统计全量，渲染端展示输入卡片下方的统计条
      const s = this.sessionStats.get(sessionId);
      if (s) sink.sessionStats(sessionId, { ...s });
    }
  }

  /** 停止会话的 agent 运行（abort 后 runLoop 会推 aborted 错误收尾；只清理本会话确认） */
  stop(sessionId: string): void {
    this.runs.get(sessionId)?.controller.abort();
    for (const [id, c] of this.pendingConfirms) {
      if (c.sessionId === sessionId) {
        c.resolve({ kind: 'deny' });
        this.pendingConfirms.delete(id);
      }
    }
  }

  /**
   * 恢复会话工作区到最近一次 agent 运行启动时的状态（撤销该次运行的文件改动）。
   * 运行进行中不可回滚（快照随运行变化）；应用重启后快照丢失（diff 面板同为瞬态，两者一致）。
   */
  async restoreWorkspace(sessionId: string): Promise<
    { ok: true; restored: number; files: DiffFile[] } | { ok: false; error: 'no-snapshot' | 'running' }
  > {
    if (this.runs.has(sessionId)) return { ok: false, error: 'running' };
    if (!this.snapshots.hasSnapshot(sessionId)) return { ok: false, error: 'no-snapshot' };
    const r = await this.snapshots.restoreSnapshot(sessionId);
    return { ok: true, ...r };
  }

  /** 放弃会话快照（提交改动后调用）：DiffPanel 变更面板随之清空，回滚入口消失 */
  clearWorkspaceSnapshot(sessionId: string): void {
    this.snapshots.clearSnapshot(sessionId);
  }

  /**
   * 会话终结（归档）：回收其运行与统计/免问缓存条目。
   * 统计已随消息持久化（session meta.stats），需要时重启回灌，无需在内存常驻。
   */
  disposeSession(sessionId: string): void {
    this.stop(sessionId);
    this.sessionApprovals.delete(sessionId);
    this.sessionStats.delete(sessionId);
  }

  /** 渲染端确认响应入口（agent:confirm-response）；决策结构非法时静默丢弃 */
  resolveConfirm(toolEventId: unknown, decision: unknown): void {
    if (typeof toolEventId !== 'string' || !isConfirmDecision(decision)) return;
    const c = this.pendingConfirms.get(toolEventId);
    if (c) {
      this.pendingConfirms.delete(toolEventId);
      c.resolve(decision);
    }
  }

  /** 应用退出前中止全部 agent 运行 */
  dispose(): void {
    for (const run of this.runs.values()) run.controller.abort();
    this.runs.clear();
    for (const [id, c] of this.pendingConfirms) {
      c.resolve({ kind: 'deny' });
      this.pendingConfirms.delete(id);
    }
    this.sessionApprovals.clear();
    this.sessionStats.clear();
  }
}

// ---- 向后兼容的模块级入口（默认实例） ----

const defaultRuntime = new AgentRuntime();

export function startAgent(input: AgentStartInput): Promise<AgentStartResult> {
  return defaultRuntime.start(input);
}

export function stopAgent(sessionId: string): void {
  defaultRuntime.stop(sessionId);
}

export function resolveConfirm(toolEventId: unknown, approve: unknown): void {
  defaultRuntime.resolveConfirm(toolEventId, approve);
}

export function disposeAgents(): void {
  defaultRuntime.dispose();
}

/** 会话终结（归档）时回收其运行与缓存（默认实例入口，desktop IPC 调用） */
export function disposeSession(sessionId: string): void {
  defaultRuntime.disposeSession(sessionId);
}

/** 恢复会话工作区到最近一次 agent 运行前（默认实例入口，desktop IPC 调用） */
export function restoreAgentWorkspace(sessionId: string): Promise<
  { ok: true; restored: number; files: DiffFile[] } | { ok: false; error: 'no-snapshot' | 'running' }
> {
  return defaultRuntime.restoreWorkspace(sessionId);
}

/** 放弃会话快照（提交改动后调用，默认实例入口） */
export function clearAgentWorkspaceSnapshot(sessionId: string): void {
  defaultRuntime.clearWorkspaceSnapshot(sessionId);
}