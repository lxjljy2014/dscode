import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { AgentToolEvent, ChatMessagePayload, DiffFile, Message, Session } from '@dscode/shared';
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
    // 空会话状态（无激活任务）直接发送：自动新建任务，避免静默吞掉输入
    if (!sessionStore.activeSession) sessionStore.createSession();
    const session = sessionStore.activeSession;
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
    session.messages.push(reply);
    generating.value = true;

    // 真实 agent：历史取非流式消息（含刚发送的用户消息）
    const history: ChatMessagePayload[] = session.messages
      .filter(m => !m.streaming)
      .map(m => ({ role: m.role, content: m.content }));
    let r: { ok: boolean };
    try {
      r = await host.agentStart(session.id, model, history, subagentId);
    } catch {
      // IPC 异常兜底：避免 generating 卡死
      r = { ok: false };
    }
    if (!r.ok) {
      reply.streaming = false;
      reply.errorCode = 'unknown';
      generating.value = false;
      void sessionStore.persistMessage(session, reply);
    }
  }

  async function stopGenerating() {
    if (!host) return;
    if (sessionStore.activeSessionId) await host.agentStop(sessionStore.activeSessionId);
  }

  /** 确认弹窗响应（allow=true 放行 / false 拒绝） */
  function respondConfirm(toolEventId: string, approve: boolean) {
    if (!host) return;
    void host.agentConfirmResponse(toolEventId, approve);
  }

  // ---- agent/workspace 事件订阅（按 sessionId 分发） ----

  function onDelta(ev: { sessionId: string; content: string; kind: 'content' | 'reasoning' }) {
    const session = sessionStore.sessions.find(s => s.id === ev.sessionId);
    const reply = session ? streamingReply(session) : null;
    if (!reply) return;
    // 推理模型的思维链与正文分流展示（思维链不落库）
    if (ev.kind === 'reasoning') {
      reply.reasoning = (reply.reasoning ?? '') + ev.content;
    } else {
      reply.content += ev.content;
    }
  }

  function onTool(ev: { sessionId: string; event: AgentToolEvent }) {
    const session = sessionStore.sessions.find(s => s.id === ev.sessionId);
    if (!session) return;
    const existing = session.toolEvents.find(e => e.id === ev.event.id);
    if (existing) {
      // 状态流转：更新既有事件
      Object.assign(existing, ev.event);
    } else {
      session.toolEvents.push(ev.event);
    }
  }

  function onConfirm(ev: { sessionId: string; toolEventId: string; name: AgentToolEvent['name']; args: string }) {
    // 主进程在发确认请求前已推 confirming 事件；此处兜底补一条，避免事件缺失
    const session = sessionStore.sessions.find(s => s.id === ev.sessionId);
    if (!session || session.toolEvents.some(e => e.id === ev.toolEventId)) return;
    session.toolEvents.push({
      id: ev.toolEventId,
      name: ev.name,
      args: ev.args,
      status: 'confirming',
      createdAt: Date.now()
    });
  }

  function onDone(ev: { sessionId: string }) {
    const session = sessionStore.sessions.find(s => s.id === ev.sessionId);
    if (!session) return;
    const reply = streamingReply(session);
    if (reply) {
      reply.streaming = false;
      session.updatedAt = Date.now();
      void sessionStore.persistMessage(session, reply);
    }
    generating.value = false;
  }

  function onError(ev: { sessionId: string; code: string; detail?: string }) {
    const session = sessionStore.sessions.find(s => s.id === ev.sessionId);
    if (!session) return;
    const reply = streamingReply(session);
    if (reply) {
      reply.streaming = false;
      reply.errorCode = ev.code;
      session.updatedAt = Date.now();
      void sessionStore.persistMessage(session, reply);
    }
    generating.value = false;
  }

  function onWorkspaceDiff(ev: { sessionId: string; files: DiffFile[] }) {
    diffBySession.set(ev.sessionId, ev.files);
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
    host.onWorkspaceDiff(onWorkspaceDiff);
  }

  subscribeEvents();

  return { generating, diffFiles, sendMessage, stopGenerating, respondConfirm };
});
