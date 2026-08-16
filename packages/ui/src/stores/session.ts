import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { Message, Session } from '@dscode/shared';
import { host } from '../bridge/host';
import { useSettingsStore } from './settings';
import { useUiStore } from './ui';

let idSeq = 0;
function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${idSeq++}`;
}

/** 路径 basename（兼容 Windows 反斜杠） */
function basename(p: string): string {
  return (
    p
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || p
  );
}

/**
 * 会话域 store：会话列表 / 分组 / 最近工作空间 / 会话持久化。
 * 文件树移到 useWorkspaceStore，agent 编排与事件分发移到 useAgentStore，职责边界收敛。
 */
export const useSessionStore = defineStore('session', () => {
  const sessions = ref<Session[]>([]);
  const activeSessionId = ref<string | null>(sessions.value[0]?.id ?? null);
  const keyword = ref('');

  /** 最近工作空间（主进程最近项目表，侧边栏分组与输入卡项目菜单的同一数据源） */
  const recentWorkspaces = ref<Array<{ path: string; name: string; lastOpenedAt: number }>>([]);
  /** 被「移除项目」移出的工作空间（任务保留，分组隐藏；重新打开项目后恢复） */
  const removedWorkspaces = ref<Array<{ path: string; name: string; lastOpenedAt: number }>>([]);
  const removedPaths = computed(() => new Set(removedWorkspaces.value.map(p => p.path)));
  /** 用户家目录（「不在项目中工作」的落点） */
  const homeDir = ref('');

  /** 刷新最近工作空间与家目录（工作目录变化、项目菜单打开时调用） */
  async function refreshWorkspaces(): Promise<void> {
    if (!host) return;
    const r = await host.listRecentProjects();
    recentWorkspaces.value = r.projects;
    removedWorkspaces.value = r.removed;
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
      if (s.archived) continue;
      const key = s.workingDirectory || '';
      const list = byWd.get(key);
      if (list) list.push(s);
      else byWd.set(key, [s]);
    }
    const byUpdated = (list: Session[]) => list.sort((a, b) => b.updatedAt - a.updatedAt);

    const seen = new Set<string>();
    const groups: Array<{ path: string; name: string; sessions: Session[] }> = [];
    // 当前工作空间置顶；被「移除项目」移出时与其他项目一致隐藏
    if (!removedPaths.value.has(currentWd)) {
      seen.add(currentWd);
      groups.push({
        path: currentWd,
        name: basename(currentWd),
        sessions: byUpdated(byWd.get(currentWd) ?? [])
      });
    }
    // 最近项目（所有选过的工作空间，即使无任务也显示；已移除的除外）
    for (const rp of recentWorkspaces.value) {
      if (seen.has(rp.path) || removedPaths.value.has(rp.path)) continue;
      seen.add(rp.path);
      groups.push({ path: rp.path, name: rp.name, sessions: byUpdated(byWd.get(rp.path) ?? []) });
    }
    // 兜底：有任务但不在最近项目里的工作空间（已移除的除外）
    for (const [wd, list] of byWd) {
      if (seen.has(wd) || removedPaths.value.has(wd)) continue;
      groups.push({ path: wd, name: basename(wd), sessions: byUpdated(list) });
    }
    return groups;
  });

  /** 已归档任务（收进侧边栏底部「已归档」区；关键字搜索同样命中） */
  const archivedSessions = computed(() => {
    const k = keyword.value.trim().toLowerCase();
    return sessions.value
      .filter(s => s.archived && (!k || s.title.toLowerCase().includes(k)))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  });

  /** 跨项目选择任务时待落定的目标任务（等 wd watcher 完成切换后再选中，避免被「切到最近任务」覆盖） */
  let pendingSelectId: string | null = null;

  /** 选中任务；任务属于其他工作空间时先切换工作空间（文件树/顶栏随之更新） */
  async function select(id: string) {
    const s = sessions.value.find(x => x.id === id);
    if (!s) return;
    const wd = useSettingsStore().settings.workingDirectory;
    if (s.workingDirectory && s.workingDirectory !== wd) {
      pendingSelectId = id;
      await useSettingsStore().save({ workingDirectory: s.workingDirectory });
    } else {
      activeSessionId.value = id;
    }
  }

  /** 从侧边栏移除项目（仅隐藏分组，任务保留；重新打开项目后恢复） */
  async function removeWorkspace(path: string): Promise<void> {
    if (host) {
      try {
        const r = await host.removeRecentProject(path);
        if (!r.ok) return;
      } catch (e) {
        console.warn('[dscode] 移除项目异常', e);
        return;
      }
    }
    // 本地立即生效：分组从侧边栏隐藏（不影响当前会话聊天）
    if (!removedPaths.value.has(path)) {
      removedWorkspaces.value = [...removedWorkspaces.value, { path, name: basename(path), lastOpenedAt: Date.now() }];
    }
    // 移除的是当前打开的项目：工作目录归零到「不在项目中工作」（家目录），
    // 避免该分组隐藏后新建任务落到看不见的组里
    if (path && path === useSettingsStore().settings.workingDirectory && homeDir.value) {
      await useSettingsStore().save({ workingDirectory: homeDir.value });
    }
    await refreshWorkspaces();
  }

  /** 归档/恢复任务；归档当前任务时切到该工作空间最近的非归档任务 */
  async function setArchived(id: string, archived: boolean): Promise<void> {
    const s = sessions.value.find(x => x.id === id);
    if (!s) return;
    s.archived = archived;
    s.updatedAt = Date.now();
    if (archived && activeSessionId.value === id) {
      const next = sessions.value
        .filter(x => !x.archived && x.workingDirectory === s.workingDirectory && x.id !== id)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      activeSessionId.value = next?.id ?? null;
    }
    if (host) {
      try {
        const r = await host.sessionSetArchived(id, archived);
        if (!r.ok) console.warn('[dscode] 归档持久化失败', id);
      } catch (e) {
        console.warn('[dscode] 归档持久化异常', e);
      }
    }
  }

  /** 持久化会话行（IPC 结构化克隆不支持 Vue 响应式 Proxy，须传普通对象）；失败记录告警，不再静默吞掉 */
  async function persistSession(session: Session): Promise<void> {
    if (!host) return;
    try {
      const r = await host.sessionsCreate({
        id: session.id,
        title: session.title,
        workingDirectory: session.workingDirectory,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        archived: session.archived ?? false,
        toolEvents: [],
        messages: []
      });
      if (!r.ok) console.warn('[dscode] 会话持久化失败', session.id);
    } catch (e) {
      console.warn('[dscode] 会话持久化异常', e);
    }
  }

  async function persistMessage(session: Session, message: Message): Promise<void> {
    if (!host) return;
    try {
    // JSONL 会话存储：先确保会话元数据（目录）存在，再追加消息日志
    await persistSession(session);
      const r = await host.sessionsAppend(session.id, {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        // steps（思维链/工具调用）随消息落库；响应式代理须转成普通对象再经 IPC 结构化克隆
        ...(message.steps && message.steps.length > 0
          ? { steps: JSON.parse(JSON.stringify(message.steps)) as Message['steps'] }
          : {}),
        ...(message.errorCode ? { errorCode: message.errorCode } : {}),
        // 回复运行统计随消息落库（重启/恢复历史后仍可展示）
        ...(message.stats ? { stats: JSON.parse(JSON.stringify(message.stats)) as Message['stats'] } : {})
      });
      if (!r.ok) console.warn('[dscode] 消息持久化失败', message.id);
    } catch (e) {
      console.warn('[dscode] 消息持久化异常', e);
    }
  }

  /** 新建任务：回到新任务页（不创建会话行；真正对话时才生成任务） */
  function createSession() {
    activeSessionId.value = null;
    // 新建任务时收起右侧面板与终端，聚焦对话区
    useUiStore().hideSidePanels();
  }

  /** 从指定消息处派生新任务（fork）：复制该消息及之前的对话为新会话并切换过去，继续追问不污染原任务 */
  function forkSession(source: Session, upToMessageId: string): Session | null {
    const idx = source.messages.findIndex(m => m.id === upToMessageId);
    if (idx < 0) return null;
    const session: Session = {
      id: nextId('s'),
      title: source.title ? `${source.title} (fork)` : '',
      // 分支任务沿用原工作空间，侧边栏归入同一分组
      workingDirectory: source.workingDirectory,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      archived: false,
      messages: [],
      toolEvents: []
    };
    // 复制对话历史（新消息 id；steps 深拷贝避免与原任务共享引用；fork 后继续对话即可分叉）
    for (const m of source.messages.slice(0, idx + 1)) {
      session.messages.push({
        ...m,
        id: nextId('m'),
        streaming: false,
        steps: m.steps && m.steps.length > 0 ? (JSON.parse(JSON.stringify(m.steps)) as Message['steps']) : undefined
      });
    }
    sessions.value.unshift(session);
    activeSessionId.value = session.id;
    useUiStore().hideSidePanels();
    void persistSession(session);
    for (const msg of session.messages) void persistMessage(session, msg);
    return session;
  }

  /** 实际生成会话（首条消息发送时调用）：任务随对话出现，侧边栏立即可见 */
  function materializeSession(): Session {
    const session: Session = {
      id: nextId('s'),
      title: '',
      // 任务绑定创建时的工作空间，侧边栏按此分组
      workingDirectory: useSettingsStore().settings.workingDirectory,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      archived: false,
      messages: [],
      toolEvents: []
    };
    sessions.value.unshift(session);
    activeSessionId.value = session.id;
    // 收起右侧面板与终端，聚焦对话区
    useUiStore().hideSidePanels();
    void persistSession(session);
    return session;
  }

  async function load(): Promise<void> {
    if (!host) return;
    const [list, projects] = await Promise.all([host.sessionsList(), host.listRecentProjects()]);
    sessions.value = list;
    recentWorkspaces.value = projects.projects;
    removedWorkspaces.value = projects.removed;
    homeDir.value = projects.homeDir;
    // 选中当前工作空间最近的非归档任务（与 wd watch 同一规则；settings 未加载时由 watch 接管）
    const wd = useSettingsStore().settings.workingDirectory;
    const inWd = list
      .filter(s => !s.archived && (s.workingDirectory || '') === wd)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    activeSessionId.value = inWd[0]?.id ?? null;
  }

  void load();

  // 工作目录变化：刷新最近工作空间 + 切到该工作空间最近的任务（无任务则空态）。
  // 由「跨项目选择任务」触发时（pendingSelectId 非空），落定目标任务而非最近任务
  if (host) {
    watch(
      () => useSettingsStore().settings.workingDirectory,
      async wd => {
        await refreshWorkspaces();
        if (pendingSelectId) {
          const target = pendingSelectId;
          pendingSelectId = null;
          activeSessionId.value = target;
          return;
        }
        const list = sessions.value
          .filter(s => !s.archived && (s.workingDirectory || '') === wd)
          .sort((a, b) => b.updatedAt - a.updatedAt);
        activeSessionId.value = list[0]?.id ?? null;
      }
    );
  }

  return {
    sessions,
    activeSessionId,
    keyword,
    recentWorkspaces,
    removedWorkspaces,
    homeDir,
    refreshWorkspaces,
    activeSession,
    hasMessage,
    filteredSessions,
    workspaceGroups,
    archivedSessions,
    select,
    createSession,
    materializeSession,
    forkSession,
    removeWorkspace,
    setArchived,
    persistSession,
    persistMessage,
    load
  };
});