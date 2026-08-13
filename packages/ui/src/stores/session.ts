import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { mockDiffFiles, mockFileTree, mockSessions } from '@dscode/shared';
import type { AgentToolEvent, ChatMessagePayload, DiffFile, FileNode, Message, Session } from '@dscode/shared';
import { host } from '../host';
import { useSettingsStore } from './settings';
import { useUiStore } from './ui';

/** 纯浏览器降级（host undefined）时的模拟流式回复语料 */
const mockReplies = [
  '收到。我先看一下相关代码的上下文，然后给出修改方案。\n\n计划如下：\n\n- 定位需要改动的模块，确认影响面\n- 以最小侵入的方式实现，保持现有行为不变\n- 完成后在右侧给出变更，供你逐条确认\n\n稍等片刻。',
  'Got it. Let me look at the surrounding code first, then propose a minimal change.\n\nMy plan:\n\n- Locate the modules involved and check the blast radius\n- Implement with the least intrusion, keeping existing behavior intact\n- Present the diff on the right for your review\n\nOne moment.',
  '明白，这个需求可以拆成两步：先调整状态结构，再更新组件绑定。\n\n我已经开始处理了，变更会实时同步到右侧「变更」面板。'
];

let idSeq = 0;
function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${idSeq++}`;
}

/** 纯浏览器 mock 流式的定时器（真实 agent 路径不使用） */
let mockTimer: ReturnType<typeof setInterval> | undefined;

function findFileNode(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === path) return node.type === 'file' ? node : null;
    if (node.children) {
      const found = findFileNode(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

export const useSessionStore = defineStore('session', () => {
  const sessions = ref<Session[]>(host ? [] : mockSessions);
  const activeSessionId = ref<string | null>(sessions.value[0]?.id ?? null);
  const keyword = ref('');
  const generating = ref(false);

  /** 各会话的 diff 结果（主进程 workspace:diff 推送，按 sessionId 缓存） */
  const diffBySession = new Map<string, DiffFile[]>();
  const diffFiles = computed<DiffFile[]>(() => {
    if (!host) return mockDiffFiles;
    return activeSessionId.value ? (diffBySession.get(activeSessionId.value) ?? []) : [];
  });

  const fileTree = ref<FileNode[]>(host ? [] : mockFileTree);
  const selectedFilePath = ref<string | null>(null);
  /** 已加载的文件内容缓存（path → content） */
  const fileContents = ref<Record<string, string>>({});

  const activeSession = computed<Session | null>(
    () => sessions.value.find(s => s.id === activeSessionId.value) ?? null
  );
  const hasMessage = computed(() => {
    const messages = activeSession.value?.messages ?? [];
    return messages.length > 0;
  });

  const filteredSessions = computed(() => {
    const k = keyword.value.trim().toLowerCase();
    if (!k) return sessions.value;
    return sessions.value.filter(s => s.title.toLowerCase().includes(k));
  });

  const selectedFile = computed(() => {
    if (!selectedFilePath.value) return null;
    const node = findFileNode(fileTree.value, selectedFilePath.value);
    if (!node) return null;
    return { ...node, content: fileContents.value[node.path] ?? '' };
  });

  function select(id: string) {
    activeSessionId.value = id;
  }

  /** 查找正在流式的 assistant 消息（会话内最后一条 streaming 消息） */
  function streamingReply(session: Session): Message | null {
    const messages = session.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].streaming) return messages[i];
    }
    return null;
  }

  /** 持久化会话行（IPC 结构化克隆不支持 Vue 响应式 Proxy，须传普通对象） */
  function persistSession(session: Session): void {
    if (!host) return;
    void host.sessionsCreate({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      toolEvents: [],
      messages: []
    });
  }

  function persistMessage(session: Session, message: Message): void {
    if (!host) return;
    void host.sessionsAppend(session.id, {
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      ...(message.errorCode ? { errorCode: message.errorCode } : {})
    });
    persistSession(session);
  }

  function createSession() {
    const session: Session = {
      id: nextId('s'),
      title: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      toolEvents: []
    };
    sessions.value.unshift(session);
    activeSessionId.value = session.id;
    // 新建任务时收起右侧面板与终端，聚焦对话区
    useUiStore().hideSidePanels();
    persistSession(session);
  }

  async function selectFile(path: string) {
    selectedFilePath.value = path;
    if (!host) return;
    const r = await host.workspaceReadFile(path);
    fileContents.value[path] = r.ok ? r.content : `（读取失败：${r.error}）`;
  }

  async function sendMessage(content: string, model = '') {
    if (generating.value) return;
    // 空会话状态（无激活任务）直接发送：自动新建任务，避免静默吞掉输入
    if (!activeSession.value) createSession();
    const session = activeSession.value;
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
    persistMessage(session, userMsg);

    const reply: Message = {
      id: nextId('m'),
      role: 'assistant',
      content: '',
      streaming: true,
      createdAt: Date.now()
    };
    session.messages.push(reply);
    generating.value = true;

    if (!host) {
      // 纯浏览器环境：模拟流式回复
      const fullText = mockReplies[Math.floor(Math.random() * mockReplies.length)];
      let cursor = 0;
      mockTimer = setInterval(() => {
        cursor = Math.min(cursor + 2 + Math.floor(Math.random() * 3), fullText.length);
        reply.content = fullText.slice(0, cursor);
        if (cursor >= fullText.length) {
          stopGenerating();
          stopMockTimer();
        }
      }, 24);
      return;
    }

    // 真实 agent：历史取非流式消息（含刚发送的用户消息）
    const history: ChatMessagePayload[] = session.messages
      .filter(m => !m.streaming)
      .map(m => ({ role: m.role, content: m.content }));
    let r: { ok: boolean };
    try {
      r = await host.agentStart(session.id, model, history);
    } catch {
      // IPC 异常兜底：避免 generating 卡死
      r = { ok: false };
    }
    if (!r.ok) {
      reply.streaming = false;
      reply.errorCode = 'unknown';
      generating.value = false;
      persistMessage(session, reply);
    }
  }

  function stopMockTimer() {
    if (mockTimer) {
      clearInterval(mockTimer);
      mockTimer = undefined;
    }
  }

  async function stopGenerating() {
    if (!host) {
      stopMockTimer();
      const session = activeSession.value;
      const reply = session ? streamingReply(session) : null;
      if (session && reply?.streaming) {
        reply.streaming = false;
        session.updatedAt = Date.now();
      }
      generating.value = false;
      return;
    }
    if (activeSessionId.value) await host.agentStop(activeSessionId.value);
  }

  /** 确认弹窗响应（allow=true 放行 / false 拒绝） */
  function respondConfirm(toolEventId: string, approve: boolean) {
    if (!host) return;
    void host.agentConfirmResponse(toolEventId, approve);
  }

  // ---- agent/workspace 事件订阅（按 sessionId 分发） ----

  function onDelta(ev: { sessionId: string; content: string; kind: 'content' | 'reasoning' }) {
    const session = sessions.value.find(s => s.id === ev.sessionId);
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
    const session = sessions.value.find(s => s.id === ev.sessionId);
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
    const session = sessions.value.find(s => s.id === ev.sessionId);
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
    const session = sessions.value.find(s => s.id === ev.sessionId);
    if (!session) return;
    const reply = streamingReply(session);
    if (reply) {
      reply.streaming = false;
      session.updatedAt = Date.now();
      persistMessage(session, reply);
    }
    generating.value = false;
  }

  function onError(ev: { sessionId: string; code: string; detail?: string }) {
    const session = sessions.value.find(s => s.id === ev.sessionId);
    if (!session) return;
    const reply = streamingReply(session);
    if (reply) {
      reply.streaming = false;
      reply.errorCode = ev.code;
      session.updatedAt = Date.now();
      persistMessage(session, reply);
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

  async function load(): Promise<void> {
    if (!host) return;
    const [list, tree] = await Promise.all([host.sessionsList(), host.workspaceTree()]);
    sessions.value = list;
    activeSessionId.value = sessions.value[0]?.id ?? null;
    fileTree.value = tree;
  }

  subscribeEvents();
  void load();

  // 工作目录变化后刷新文件树
  if (host) {
    const h = host;
    watch(
      () => useSettingsStore().settings.workingDirectory,
      async () => {
        fileTree.value = await h.workspaceTree();
      }
    );
  }

  return {
    sessions,
    activeSessionId,
    keyword,
    generating,
    diffFiles,
    fileTree,
    selectedFilePath,
    fileContents,
    activeSession,
    hasMessage,
    filteredSessions,
    selectedFile,
    select,
    createSession,
    selectFile,
    sendMessage,
    stopGenerating,
    respondConfirm,
    load
  };
});
