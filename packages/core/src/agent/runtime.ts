import type {
  AgentToolName,
  ChatMessagePayload,
  ConfirmDecision,
  PermissionMode,
  ProviderConfig,
  SessionStats,
  Skill
} from '@dscode/shared';
import { ApiError, resolveAdapter, streamChatWithRetry } from '../adapters';
import type { ChatUsage } from '../adapters/types';
import type { LlmCache } from '../cache/llm-cache';
import { isConfirmDecision } from '../gate/gate';
import { toolSchemas } from '../tools';
import { DiffSnapshotStore } from '../workspace/diff';
import { executeToolBatch } from './tool-batch';
import type { AgentEventSink } from './types';

/**
 * agent 运行时：执行「LLM 流式对话 + 工具循环」，与宿主解耦（事件经 AgentEventSink 上抛）。
 * 会话按 sessionId 管理；配置（供应商/工作目录/权限模式）由宿主读自己的持久化后传入，
 * 渲染端不可注入 baseUrl/key。
 */

const MAX_TOOL_ROUNDS = 30;
/** 单轮 LLM 请求最长等待（含流式全程） */
const ROUND_TIMEOUT_MS = 5 * 60_000;

/** 系统提示词：默认值，可经 AgentStartInput.config.systemPrompt 覆盖 */
export const SYSTEM_PROMPT = `你是 DSCode 内置的编程助手，在用户的工作目录中工作。可以调用工具读取文件、列出目录、搜索代码、执行命令、写入或编辑文件。规则：
- 修改代码前先阅读相关文件，理解上下文
- 写文件/编辑/执行命令会经过系统权限门控，可能需要用户确认
- 工作目录内的路径一律使用相对路径
- 回答语言与用户提问一致
- 只做用户要求的事，不擅自扩大改动范围`;

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
    /** LLM 回复缓存（省成本；命中时重放缓存响应，不调 API） */
    llmCache?: LlmCache;
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
    const { sessionId, model, rawMessages, sink, config } = input;

    // 先做输入校验，避免非法输入中止正在进行的运行
    const provider = config.providers[0];
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
    // agent 启动时快照工作目录，作为本次运行 diff 的基线
    await this.snapshots.initSnapshot(sessionId, config.workingDirectory);

    const context: unknown[] = [
      { role: 'system', content: config.systemPrompt ?? SYSTEM_PROMPT },
      // 原样透传渲染端重建的历史（user/assistant tool_calls/tool 结果），
      // 与运行时 loop 内 push 的消息结构一致，保证跨运行请求前缀字节级稳定
      ...rawMessages
    ];

    run.done = this.runLoop(
      sessionId,
      config.workingDirectory,
      config.permissionMode,
      config.permissionModeSource,
      {
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        adapter: provider.adapter,
        thinking: config.thinking ?? provider.thinking,
        reasoningEffort: config.reasoningEffort ?? provider.reasoningEffort,
        maxTokens: config.maxTokens ?? provider.maxTokens
      },
      resolvedModel,
      context,
      config.browsingEnabled !== false,
      config.skills ?? [],
      sink,
      config.llmCache
    ).finally(() => {
      if (this.runs.get(sessionId) === run) this.runs.delete(sessionId);
      this.snapshots.clearSnapshot(sessionId);
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

  private async runLoop(
    sessionId: string,
    cwd: string,
    permissionMode: PermissionMode,
    permissionModeSource: (() => PermissionMode | Promise<PermissionMode>) | undefined,
    provider: {
      baseUrl: string;
      apiKey: string;
      adapter?: string;
      thinking?: boolean;
      reasoningEffort?: 'off' | 'high' | 'max';
      maxTokens?: number;
    },
    model: string,
    messages: unknown[],
    browsingEnabled: boolean,
    skills: Skill[],
    sink: AgentEventSink,
    llmCache?: LlmCache
  ): Promise<void> {
    const run = this.runs.get(sessionId);
    if (!run) return;
    const signal = run.controller.signal;

    try {
      let totalPrompt = 0;
      let totalCompletion = 0;
      // API 前缀缓存命中的输入 token 累计（DeepSeek 上下文缓存；随前缀稳定而升高，随 usage 事件落库）
      let totalCachedPrompt = 0;
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const combined = AbortSignal.any([signal, AbortSignal.timeout(ROUND_TIMEOUT_MS)]);
        const roundStart = Date.now();
        // 首 token 耗时（首个非空正文增量；缓存命中轮保持 null 不计数）
        let firstTokenMs: number | null = null;
        // 一次 LLM 请求（聚合流式文本，供缓存写入）；瞬时故障（429/5xx/网络）指数退避重试，
        // 借鉴官方 harness llm-retry（可取消退避 + jitter，中止/超时不重试）
        // 无可用技能时不暴露 skill 工具（避免模型调用必败工具）；codeMode=false（普通模式）
        const tools = toolSchemas(browsingEnabled, false, skills.length > 0);
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
              sink.delta(sessionId, 'content', text);
            },
            text => {
              reasoningBuf += text;
              sink.delta(sessionId, 'reasoning', text);
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
        if (usage) s.contextTokens = usage.promptTokens;
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
            skills,
          }
        );
        if (!outcome.continueLoop) return;
        // 工具标记本轮结束（concludesTurn）：本轮不再回模型，直接完成运行
        if (outcome.concluded) {
sink.usage(sessionId, { promptTokens: totalPrompt, completionTokens: totalCompletion, cachedPromptTokens: totalCachedPrompt });
          sink.done(sessionId);
          return;
        }
      }
sink.usage(sessionId, { promptTokens: totalPrompt, completionTokens: totalCompletion, cachedPromptTokens: totalCachedPrompt });
      sink.done(sessionId);
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