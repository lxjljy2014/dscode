import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import type {
  AgentToolEvent,
  AssistantStep,
  ChatMessagePayload,
  ConfirmDecision,
  DiffFile,
  Message,
  MessageAttachment,
  MessageContext,
  Session,
  SessionStats
} from '@dscode/shared';
import { host } from '../bridge/host';
import { useSessionStore } from './session';
import { useSettingsStore } from './settings';

let idSeq = 0;
function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${idSeq++}`;
}

/**
 * 工具结果内容（跨运行历史重建用，与运行时 push 的 role:'tool' 消息逐字节一致）：
 * done 用全量输出（旧数据缺省回退摘要），error 用与运行时一致的失败文案，其余（denied/未完成）给占位。
 */
function toolResultContent(e: AgentToolEvent): string {
  if (e.status === 'done') return e.content ?? e.summary ?? '(no output)';
  if (e.status === 'error') return `执行失败：${e.error ?? '未知错误'}`;
  return '已拒绝执行';
}

/** 把 @ 引用与文本附件的内容注入用户消息（发送与历史重建保持一致，保证跨运行前缀缓存稳定） */
function injectFileContents(
  content: string,
  contexts?: MessageContext[],
  attachments?: MessageAttachment[]
): string {
  const blocks: string[] = [];
  for (const c of contexts ?? []) {
    blocks.push(`【文件：${c.path}】\n${c.content}`);
  }
  for (const a of attachments ?? []) {
    if (a.content) {
      blocks.push(`【附件：${a.path}】\n${a.content}`);
    } else if (a.dataUrl) {
      // 图片附件：文本模型无法读取像素内容，附上文件名说明，避免空消息
      blocks.push(`【图片附件：${a.name}】（纯文本模型无法读取图片内容）`);
    }
  }
  if (blocks.length === 0) return content;
  const prefix = blocks.join('\n\n');
  return content ? `${prefix}\n\n${content}` : prefix;
}

/**
 * agent 编排 store：生成状态、发送/停止、确认响应、事件订阅分发与 diff 缓存。
 * 自 session store 拆出：会话本身由 useSessionStore 管理，本 store 只负责「驱动一次 agent 运行」。
 */
export const useAgentStore = defineStore('agent', () => {
  const sessionStore = useSessionStore();
  const settingsStore = useSettingsStore();
  const generating = ref(false);

  /** 待用户确认的工具调用（覆盖输入框的确认卡片数据源；运行时未响应前保持） */
  const pendingConfirm = ref<{ toolEventId: string; name: AgentToolEvent['name']; args: string } | null>(null);

  /** 工具卡最短展示时长：快速工具的「执行中」至少展示一小段时间，避免一闪而过看不到 */
  const TOOL_MIN_DISPLAY_MS = 450;
  /** 工具首次展示时间戳（用于最短展示时长计算） */
  const toolShownAt = new Map<string, number>();

  /** 各回复的运行统计中间态（keyed by 回复消息 id；结束时收敛为 Message.stats 附到消息上） */
  interface RunningStats {
    startAt: number;
    firstTokenMs?: number;
    promptTokens?: number;
    completionTokens?: number;
  }
  const runningStats = new Map<string, RunningStats>();

  /** 各会话最近一次运行使用的模型（自动压缩按所属供应商的 contextWindow 判定阈值） */
  const sessionModels = new Map<string, string>();

  /** 收敛一次回复的运行统计：结束时间 + 用时 + 首token + token 速率所需数据 */
  function finalizeStats(reply: Message) {
    const s = runningStats.get(reply.id);
    runningStats.delete(reply.id);
    if (!s) return;
    reply.stats = {
      startAt: s.startAt,
      endAt: Date.now(),
      ...(s.firstTokenMs !== undefined ? { firstTokenMs: s.firstTokenMs } : {}),
      ...(s.promptTokens !== undefined ? { promptTokens: s.promptTokens } : {}),
      ...(s.completionTokens !== undefined ? { completionTokens: s.completionTokens } : {})
    };
  }

  /** 会话级运行统计（输入卡片下方统计条；运行时每次运行结束推送全量；响应式对象供 computed 追踪） */
/** 输入卡片下方统计条：读当前会话的 stats（随会话 meta.json 持久化，重开恢复；运行中由 session-stats 事件写入） */
const sessionStats = computed<SessionStats | null>(() => {
  const active = sessionStore.activeSession;
  return active?.stats ?? null;
});

  /** 各会话的 diff 结果（主进程 workspace:diff 推送，按 sessionId 缓存）。
   *  必须用 reactive 包裹 Map，否则 computed 不追踪 Map.set，diff 面板不会实时刷新。 */
  const diffBySession = reactive(new Map<string, DiffFile[]>());
  const diffFiles = computed<DiffFile[]>(() => {
    const id = sessionStore.activeSessionId;
    return id ? (diffBySession.get(id) ?? []) : [];
  });

  /** 查找正在流式的 assistant 消息（会话内最后一条 streaming 消息） */
  function streamingReply(session: Session): Message | null {
    const messages = session.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].streaming) return messages[i];
    }
    return null;
  }

  async function sendMessage(
    content: string,
    model = '',
    subagentId = '',
    reasoningEffort?: 'off' | 'high' | 'max',
    attachments?: MessageAttachment[],
    contexts?: MessageContext[]
  ) {
    if (generating.value) return;
    if (!host) return;
    // 空会话状态（无激活任务）直接发送：首条消息才生成任务，避免静默吞掉输入
    let session = sessionStore.activeSession;
    if (!session) session = sessionStore.materializeSession();
    if (!session) return;
    if (model) sessionModels.set(session.id, model);

    const userMsg: Message = {
      id: nextId('m'),
      role: 'user',
      content,
      createdAt: Date.now(),
      ...(attachments && attachments.length > 0 ? { attachments: attachments.map(a => ({ ...a })) } : {}),
      ...(contexts && contexts.length > 0 ? { contexts: contexts.map(c => ({ ...c })) } : {})
    };
    session.messages.push(userMsg);
    if (!session.title) {
      const raw = content || contexts?.[0]?.name || attachments?.[0]?.name || '';
      session.title = raw.length > 24 ? `${raw.slice(0, 24)}…` : raw;
    }
    session.updatedAt = Date.now();
    void sessionStore.persistMessage(session, userMsg);

    const reply: Message = {
      id: nextId('m'),
      role: 'assistant',
      content: '',
      streaming: true,
      createdAt: Date.now()
    };
    // 运行统计起点：从发送时刻开始计时（首token/用时/token 速率）
    runningStats.set(reply.id, { startAt: Date.now() });
    session.messages.push(reply);
    generating.value = true;

    // 真实 agent：历史取非流式消息（含刚发送的用户消息），重建为与运行时上下文逐字节一致的结构，
    // 保证跨运行请求前缀缓存稳定（DeepSeek 前缀缓存按 token 序列命中）：
    // - user 消息原样
    // - assistant 带工具调用：按轮分组（reasoning 开启新组、tool 归入当前组、text 跳过——运行时纯文本轮不进上下文），
    //   每组重建 { role:'assistant', content:'', reasoning_content?, tool_calls:[...] }，
    //   随后逐条补 { role:'tool', tool_call_id, content } 结果消息，与运行时 loop 内 push 的序列一致
    // - assistant 纯文本（无工具调用）：content 原样
    const history: ChatMessagePayload[] = [];
    for (const m of session.messages) {
      if (m.streaming) continue;
      if (m.role === 'user') {
        history.push({ role: 'user', content: injectFileContents(m.content, m.contexts, m.attachments) });
        continue;
      }
      const steps = m.steps ?? [];
      const toolSteps = steps.filter(s => s.kind === 'tool');
      if (toolSteps.length === 0) {
        history.push({ role: 'assistant', content: m.content });
        continue;
      }
      // 按轮分组（一个 assistant 回复可能含多轮工具循环）
      const groups: Array<{ reasoning: string; tools: Array<Extract<AssistantStep, { kind: 'tool' }>> }> = [];
      let current: (typeof groups)[number] | null = null;
      for (const s of steps) {
        if (s.kind === 'reasoning') {
          current = { reasoning: s.content, tools: [] };
          groups.push(current);
        } else if (s.kind === 'tool') {
          if (!current) {
            current = { reasoning: '', tools: [] };
            groups.push(current);
          }
          current.tools.push(s);
        }
      }
      for (const g of groups) {
        if (g.tools.length === 0) continue;
        history.push({
          role: 'assistant',
          content: '',
          ...(g.reasoning.length > 0 ? { reasoning_content: g.reasoning } : {}),
          tool_calls: g.tools.map(s => ({
            id: s.event.toolCallId ?? s.event.id,
            type: 'function' as const,
            function: { name: s.event.name, arguments: s.event.args }
          }))
        });
        for (const s of g.tools) {
          history.push({
            role: 'tool',
            tool_call_id: s.event.toolCallId ?? s.event.id,
            content: toolResultContent(s.event)
          });
        }
      }
    }
    let r: { ok: boolean; error?: string };
    try {
      r = await host.agentStart(session.id, model, history, subagentId, reasoningEffort);
    } catch {
      // IPC 异常兜底：避免 generating 卡死
      r = { ok: false, error: 'IPC 调用异常' };
    }
    if (!r.ok) {
      reply.streaming = false;
      // 启动失败原因映射为错误码；详情附在气泡下方便于排障
      reply.errorCode = r.error === 'already-running' ? 'running' : 'unknown';
      reply.errorDetail = r.error;
      // 从未真正开始流式输出：丢弃统计，避免残留
      runningStats.delete(reply.id);
      generating.value = false;
      void sessionStore.persistMessage(session, reply);
    }
  }

  async function stopGenerating() {
    if (!host) return;
    if (sessionStore.activeSessionId) await host.agentStop(sessionStore.activeSessionId);
  }

  /** 确认卡片响应（三选项：允许一次/本会话/拒绝；拒绝由运行时停止任务） */
  function respondConfirm(toolEventId: string, decision: ConfirmDecision) {
    if (!host) return;
    if (pendingConfirm.value?.toolEventId === toolEventId) pendingConfirm.value = null;
    void host.agentConfirmResponse(toolEventId, decision);
  }

  /** 会话统计零值基底（onContext 投影与压缩后刷新共用：字段缺省时兜底） */
  function emptyStats(): SessionStats {
    return {
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
  }

  /** /compact 进行中：会话流末尾显示压缩状态行（摘要是一次 LLM 调用，秒级到分钟级） */
  const compacting = ref(false);

  /** 压缩会话历史（/compact）：主进程摘要旧消息并替换为检查点，成功后更新内存态 */
  async function compactSession(): Promise<{ ok: boolean; error?: string }> {
    if (!host) return { ok: false, error: 'IPC 不可用' };
    const session = sessionStore.activeSession;
    if (!session) return { ok: false, error: '无激活会话' };
    compacting.value = true;
    try {
      const r = await host.compactSession(session.id);
      if (r.ok) {
        session.messages = r.messages;
        // 上下文占用立即回落（ContextMeter 显示压缩后的新投影；累计统计保留）
        if (!session.stats) session.stats = emptyStats();
        session.stats.contextTokens = r.context.contextTokens;
        session.stats.systemTokens = r.context.systemTokens;
        session.stats.toolsTokens = r.context.toolsTokens;
        session.stats.messagesTokens = r.context.messagesTokens;
        return { ok: true };
      }
      return { ok: false, error: r.error };
    } catch {
      return { ok: false, error: 'IPC 调用异常' };
    } finally {
      compacting.value = false;
    }
  }

  /** 回滚 agent 文件改动：恢复到最近一次运行启动前的状态（DiffPanel「恢复到运行前」） */
  async function restoreWorkspace(): Promise<{ ok: boolean; restored?: number; error?: string }> {
    if (!host) return { ok: false, error: 'IPC 不可用' };
    const sessionId = sessionStore.activeSessionId;
    if (!sessionId) return { ok: false, error: '无激活会话' };
    try {
      const r = await host.workspaceRestore(sessionId);
      if (r.ok) {
        diffBySession.set(sessionId, r.files);
        return { ok: true, restored: r.restored };
      }
      return { ok: false, error: r.error };
    } catch {
      return { ok: false, error: 'IPC 调用异常' };
    }
  }

  /** 提交 diff 面板列出的改动（只提交这些路径），成功后放弃快照（变更面板清空、回滚入口消失） */
  async function commitChanges(message: string): Promise<{ ok: boolean; error?: string }> {
    if (!host) return { ok: false, error: 'IPC 不可用' };
    const sessionId = sessionStore.activeSessionId;
    if (!sessionId) return { ok: false, error: '无激活会话' };
    const paths = diffFiles.value.map(f => f.path);
    if (paths.length === 0) return { ok: false, error: '无待提交改动' };
    try {
      const r = await host.gitCommit(settingsStore.settings.workingDirectory, paths, message);
      if (!r.ok) return { ok: false, error: r.error };
      await host.workspaceClearSnapshot(sessionId);
      diffBySession.set(sessionId, []);
      return { ok: true };
    } catch {
      return { ok: false, error: 'IPC 调用异常' };
    }
  }

  /**
   * 上下文压力自动压缩：运行结束时占用达到阈值（占所属供应商 contextWindow 的百分比）自动压缩。
   * 触发条件逐层收紧，避免无意义/循环压缩：消息过少（压缩保留最近 3 条 + 检查点）不压、
   * 非激活会话不压（压缩状态行只对激活会话展示）、压缩/生成进行中不压。
   */
  async function maybeAutoCompact(sessionId: string): Promise<void> {
    if (!host || compacting.value || generating.value) return;
    const s = settingsStore.settings;
    if (!s.autoCompact) return;
    const session = sessionStore.sessions.find(x => x.id === sessionId);
    if (!session || session.id !== sessionStore.activeSessionId) return;
    if (session.messages.length <= 6) return;
    const contextTokens = session.stats?.contextTokens ?? 0;
    if (contextTokens <= 0) return;
    const model = sessionModels.get(sessionId) ?? '';
    const provider = s.providers.find(p => p.models.includes(model)) ?? s.providers[0];
    // 未配置 contextWindow 的供应商按 128K 兜底（常见上下文规模，宁可早压不越界）
    const contextWindow = provider?.contextWindow ?? 128_000;
    if (contextTokens >= contextWindow * (s.autoCompactThreshold / 100)) {
      await compactSession();
    }
  }

  // ---- agent/workspace 事件订阅（按 sessionId 分发） ----

  function onDelta(ev: { sessionId: string; content: string; kind: 'content' | 'reasoning' }) {
    const session = sessionStore.sessions.find(s => s.id === ev.sessionId);
    const reply = session ? streamingReply(session) : null;
    if (!reply) return;
    const steps = reply.steps ?? [];
    const last = steps[steps.length - 1];
    if (ev.kind === 'reasoning') {
      // 思考：追加到最后一轮 reasoning step（最后不是 reasoning 则新建一轮）
      if (last && last.kind === 'reasoning') {
        last.content += ev.content;
      } else {
        steps.push({ kind: 'reasoning', content: ev.content });
      }
    } else {
      reply.content += ev.content;
      // 正文：追加到最后一个 text step（最后是 tool/reasoning 或空则新建）
      if (last && last.kind === 'text') {
        last.content += ev.content;
      } else {
        steps.push({ kind: 'text', content: ev.content });
      }
      // 首 token 计时：第一个非空正文增量到达时记录
      const st = runningStats.get(reply.id);
      if (st && st.firstTokenMs === undefined && ev.content.length > 0) {
        st.firstTokenMs = Date.now() - st.startAt;
      }
    }
    reply.steps = steps;
  }

  /** token 用量事件：记录到运行统计（正常结束前由主进程推送 agent:usage） */
  function onUsage(ev: { sessionId: string; usage: { promptTokens: number; completionTokens: number } }) {
    const session = sessionStore.sessions.find(s => s.id === ev.sessionId);
    const reply = session ? streamingReply(session) : null;
    if (!reply) return;
    const st = runningStats.get(reply.id);
    if (st) {
      st.promptTokens = ev.usage.promptTokens;
      st.completionTokens = ev.usage.completionTokens;
    }
  }

  function onTool(ev: { sessionId: string; event: AgentToolEvent }) {
    const session = sessionStore.sessions.find(s => s.id === ev.sessionId);
    if (!session) return;
    const existing = session.toolEvents.find(e => e.id === ev.event.id);
    if (existing) {
      // 状态流转：终态（done/error/denied）延迟到「执行中」至少展示一小段时间
      const terminal = ev.event.status === 'done' || ev.event.status === 'error' || ev.event.status === 'denied';
      if (terminal) {
        const shownAt = toolShownAt.get(ev.event.id) ?? Date.now();
        const wait = Math.max(0, TOOL_MIN_DISPLAY_MS - (Date.now() - shownAt));
        setTimeout(() => {
          Object.assign(existing, ev.event);
          toolShownAt.delete(ev.event.id);
          // 工具终态：把当前回复（含最新 steps）落库，运行中途崩溃也尽量少丢
          const reply = streamingReply(session);
          if (reply) void sessionStore.persistMessage(session, reply);
        }, wait);
      } else {
        Object.assign(existing, ev.event);
      }
    } else {
      session.toolEvents.push(ev.event);
      // 记录首次展示时间戳：最短展示时长以「首次出现」为起点（此前从不 set，退化为固定 450ms 延迟）
      toolShownAt.set(ev.event.id, Date.now());
      // 首次出现：把 tool step 追加到正在流式的回复步骤里
      const reply = streamingReply(session);
      if (reply) {
        const steps = reply.steps ?? [];
        steps.push({ kind: 'tool', event: ev.event });
        reply.steps = steps;
      }
    }
  }

  function onConfirm(ev: { sessionId: string; toolEventId: string; name: AgentToolEvent['name']; args: string }) {
    // 主进程在发确认请求前已推 confirming 事件；此处兜底补一条，避免事件缺失
    const session = sessionStore.sessions.find(s => s.id === ev.sessionId);
    if (!session) return;
    if (!session.toolEvents.some(e => e.id === ev.toolEventId)) {
      session.toolEvents.push({
        id: ev.toolEventId,
        name: ev.name,
        args: ev.args,
        status: 'confirming',
        createdAt: Date.now()
      });
    }
    // 覆盖输入框的确认卡片：记录当前待确认工具（仅当属于当前激活会话时展示）
    if (session.id === sessionStore.activeSessionId) {
      pendingConfirm.value = { toolEventId: ev.toolEventId, name: ev.name, args: ev.args };
    }
  }

  function onDone(ev: { sessionId: string }) {
    const session = sessionStore.sessions.find(s => s.id === ev.sessionId);
    if (!session) return;
    const reply = streamingReply(session);
    if (reply) {
      reply.streaming = false;
      // 收敛运行统计（用时/首token/token 速率），随消息展示但不落库
      finalizeStats(reply);
      session.updatedAt = Date.now();
      void sessionStore.persistMessage(session, reply);
    }
    generating.value = false;
    pendingConfirm.value = null;
    // 运行正常结束：检查上下文压力，达到阈值自动压缩对话历史
    void maybeAutoCompact(ev.sessionId);
  }

  function onError(ev: { sessionId: string; code: string; detail?: string }) {
    const session = sessionStore.sessions.find(s => s.id === ev.sessionId);
    if (!session) return;
    const reply = streamingReply(session);
    if (reply) {
      reply.streaming = false;
      reply.errorCode = ev.code;
      // 错误详情（主进程附带的真实原因）随气泡展示，方便排障
      if (ev.detail) reply.errorDetail = ev.detail;
      // 错误中断也收敛统计（token 用量可能缺失）
      finalizeStats(reply);
      session.updatedAt = Date.now();
      void sessionStore.persistMessage(session, reply);
    }
    generating.value = false;
    pendingConfirm.value = null;
  }

  function onWorkspaceDiff(ev: { sessionId: string; files: DiffFile[] }) {
    diffBySession.set(ev.sessionId, ev.files);
  }

  function onSessionStats(ev: { sessionId: string; stats: SessionStats }) {
    // 整体替换触发响应式（computed 依赖 sessionStatsBySession.value）
    // 持久化到会话 meta.json：重开/切换会话后统计条仍展示
    const session = sessionStore.sessions.find(s => s.id === ev.sessionId);
    if (session) {
      session.stats = ev.stats;
      if (host) {
        host.sessionsStats(ev.sessionId, ev.stats).catch(() => {});
      }
    }
  }

  /** 上下文占用投影：实时更新会话统计的 context/system/tools/messages（仅内存；run 结束的 sessionStats 才落库） */
  function onContext(ev: { sessionId: string; contextTokens: number; systemTokens: number; toolsTokens: number; messagesTokens: number }) {
    const session = sessionStore.sessions.find(s => s.id === ev.sessionId);
    if (!session) return;
    if (!session.stats) session.stats = emptyStats();
    session.stats.contextTokens = ev.contextTokens;
    session.stats.systemTokens = ev.systemTokens;
    session.stats.toolsTokens = ev.toolsTokens;
    session.stats.messagesTokens = ev.messagesTokens;
  }

  let subscribed = false;
  function subscribeEvents(): void {
    if (!host || subscribed) return;
    subscribed = true;
    host.onAgentDelta(onDelta);
    host.onAgentTool(onTool);
    host.onAgentConfirm(onConfirm);
    host.onAgentDone(onDone);
    host.onAgentError(onError);
    host.onAgentUsage(onUsage);
    host.onWorkspaceDiff(onWorkspaceDiff);
    host.onSessionStats(onSessionStats);
    // onAgentContext 为后加桥接方法：旧 preload 未暴露时会缺失，降级跳过而非让整个 setup 崩溃
    host.onAgentContext?.(onContext);
  }

  subscribeEvents();

  return {
    generating,
    pendingConfirm,
    compacting,
    diffFiles,
    sessionStats,
    sendMessage,
    stopGenerating,
    respondConfirm,
    compactSession,
    restoreWorkspace,
    commitChanges
  };
});