import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { AgentToolEvent, ChatMessagePayload, DiffFile, FileNode, Message, Session } from '@dscode/shared';
import { host } from '../bridge/host';
import { useSettingsStore } from './settings';
import { useUiStore } from './ui';

let idSeq = 0;
function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${idSeq++}`;
}

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

/** 路径 basename（兼容 Windows 反斜杠） */
function basename(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
}

export const useSessionStore = defineStore('session', () => {
  const sessions = ref<Session[]>([]);
  const activeSessionId = ref<string | null>(sessions.value[0]?.id ?? null);
  const keyword = ref('');
  const generating = ref(false);

  /** 各会话的 diff 结果（主进程 workspace:diff 推送，按 sessionId 缓存） */
  const diffBySession = new Map<string, DiffFile[]>();
  const diffFiles = computed<DiffFile[]>(
    () => (activeSessionId.value ? (diffBySession.get(activeSessionId.value) ?? []) : [])
  );

  const fileTree = ref<FileNode[]>([]);
  const selectedFilePath = ref<string | null>(null);
  /** 已加载的文件内容缓存（path → content） */
  const fileContents = ref<Record<string, string>>({});

  /** 最近工作空间（主进程最近项目表，侧边栏分组与输入卡项目菜单的同一数据源） */
  const recentWorkspaces = ref<Array<{ path: string; name: string; lastOpenedAt: number }>>([]);
  /** 用户家目录（「不在项目中工作」的落点） */
  const homeDir = ref('');

  /** 刷新最近工作空间与家目录（工作目录变化、项目菜单打开时调用） */
  async function refreshWorkspaces(): Promise<void> {
    if (!host) return;
    const r = await host.listRecentProjects();
    recentWorkspaces.value = r.projects;
    homeDir.value = r.homeDir;
  }

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

  /**
   * 工作空间分组：来源 = 最近项目列表（所有选过的工作空间都会出现）∪ 有任务的工作空间兜底。
   * 当前工作空间置顶（即使没有任务）；其余按最近打开时间倒序；任务在组内按 updatedAt 倒序。
   */
  const workspaceGroups = computed<Array<{ path: string; name: string; sessions: Session[] }>>(() => {
    const currentWd = useSettingsStore().settings.workingDirectory;
    const byWd = new Map<string, Session[]>();
    for (const s of filteredSessions.value) {
      const key = s.workingDirectory || '';
      const list = byWd.get(key);
      if (list) list.push(s);
      else byWd.set(key, [s]);
    }
    const byUpdated = (list: Session[]) => list.sort((a, b) => b.updatedAt - a.updatedAt);

    const seen = new Set<string>();
    const groups: Array<{ path: string; name: string; sessions: Session[] }> = [];
    // 当前工作空间置顶
    seen.add(currentWd);
    groups.push({
      path: currentWd,
      name: basename(currentWd),
      sessions: byUpdated(byWd.get(currentWd) ?? [])
    });
    // 最近项目（所有选过的工作空间，即使无任务也显示）
    for (const rp of recentWorkspaces.value) {
      if (seen.has(rp.path)) continue;
      seen.add(rp.path);
      groups.push({ path: rp.path, name: rp.name, sessions: byUpdated(byWd.get(rp.path) ?? []) });
    }
    // 兜底：有任务但不在最近项目里的工作空间
    for (const [wd, list] of byWd) {
      if (seen.has(wd)) continue;
      groups.push({ path: wd, name: basename(wd), sessions: byUpdated(list) });
    }
    return groups;
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
      workingDirectory: session.workingDirectory,
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
      // 任务绑定创建时的工作空间，侧边栏按此分组
      workingDirectory: useSettingsStore().settings.workingDirectory,
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
    if (!host) return;
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

  async function stopGenerating() {
    if (!host) return;
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
    const [list, tree, projects] = await Promise.all([
      host.sessionsList(),
      host.workspaceTree(),
      host.listRecentProjects()
    ]);
    sessions.value = list;
    fileTree.value = tree;
    recentWorkspaces.value = projects.projects;
    homeDir.value = projects.homeDir;
    // 选中当前工作空间最近的任务（与 wd watch 同一规则；settings 未加载时由 watch 接管）
    const wd = useSettingsStore().settings.workingDirectory;
    const inWd = list.filter(s => (s.workingDirectory || '') === wd).sort((a, b) => b.updatedAt - a.updatedAt);
    activeSessionId.value = inWd[0]?.id ?? null;
  }

  subscribeEvents();
  void load();

  // 工作目录变化：刷新文件树与最近工作空间 + 切到该工作空间最近的任务（无任务则空态）
  if (host) {
    const h = host;
    watch(
      () => useSettingsStore().settings.workingDirectory,
      async wd => {
        fileTree.value = await h.workspaceTree();
        await refreshWorkspaces();
        const list = sessions.value
          .filter(s => (s.workingDirectory || '') === wd)
          .sort((a, b) => b.updatedAt - a.updatedAt);
        activeSessionId.value = list[0]?.id ?? null;
      }
    );
  }

  return {
    sessions,
    activeSessionId,
    keyword,
    generating,
    recentWorkspaces,
    homeDir,
    refreshWorkspaces,
    diffFiles,
    fileTree,
    selectedFilePath,
    fileContents,
    activeSession,
    hasMessage,
    filteredSessions,
    workspaceGroups,
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
