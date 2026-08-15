import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type {
  AgentToolEvent,
  ChatMessagePayload,
  ConfirmDecision,
  DiffFile,
  Message,
  Session,
  SessionStats
} from '@dscode/shared';
import { host } from '../bridge/host';
import { useSessionStore } from './session';

let idSeq = 0;
function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${idSeq++}`;
}

/**
 * agent 编排 store：生成状态、发送/停止、确认响应、事件订阅分发与 diff 缓存。
 * 自 session store 拆出：会话本身由 useSessionStore 管理，本 store 只负责「驱动一次 agent 运行」。
 */
export const useAgentStore = defineStore('agent', () => {
  const sessionStore = useSessionStore();
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
  const sessionStatsBySession = ref<Record<string, SessionStats>>({});
  const sessionStats = computed<SessionStats | null>(() => {
    const id = sessionStore.activeSessionId;
    return id ? (sessionStatsBySession.value[id] ?? null) : null;
  });

  /** 各会话的 diff 结果（主进程 workspace:diff 推送，按 sessionId 缓存） */
  const diffBySession = new Map<string, DiffFile[]>();
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

  async function sendMessage(content: string, model = '', subagentId = '') {
    if (generating.value) return;
    if (!host) return;
    // 空会话状态（无激活任务）直接发送：首条消息才生成任务，避免静默吞掉输入
    let session = sessionStore.activeSession;
    if (!session) session = sessionStore.materializeSession();
    if (!session) return;

    const userMsg: Message = {
      id: nextId('m'),
      role: 'user',
      content,
      createdAt: Date.now()
    };
    session.messages.push(userMsg);
    if (!session.title) {
      session.title = content.length > 24 ? `${content.slice(0, 24)}…` : content;
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

    // 真实 agent：历史取非流式消息（含刚发送的用户消息）
    const history: ChatMessagePayload[] = session.messages
      .filter(m => !m.streaming)
      .map(m => ({ role: m.role, content: m.content }));
    let r: { ok: boolean; error?: string };
    try {
      r = await host.agentStart(session.id, model, history, subagentId);
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
    sessionStatsBySession.value = { ...sessionStatsBySession.value, [ev.sessionId]: ev.stats };
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
  }

  subscribeEvents();

  return { generating, pendingConfirm, diffFiles, sessionStats, sendMessage, stopGenerating, respondConfirm };
});
