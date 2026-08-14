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

  function select(id: string) {
    activeSessionId.value = id;
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
      const r = await host.sessionsAppend(session.id, {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        ...(message.errorCode ? { errorCode: message.errorCode } : {})
      });
      if (!r.ok) console.warn('[dscode] 消息持久化失败', message.id);
      await persistSession(session);
    } catch (e) {
      console.warn('[dscode] 消息持久化异常', e);
    }
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
    void persistSession(session);
  }

  async function load(): Promise<void> {
    if (!host) return;
    const [list, projects] = await Promise.all([host.sessionsList(), host.listRecentProjects()]);
    sessions.value = list;
    recentWorkspaces.value = projects.projects;
    homeDir.value = projects.homeDir;
    // 选中当前工作空间最近的任务（与 wd watch 同一规则；settings 未加载时由 watch 接管）
    const wd = useSettingsStore().settings.workingDirectory;
    const inWd = list.filter(s => (s.workingDirectory || '') === wd).sort((a, b) => b.updatedAt - a.updatedAt);
    activeSessionId.value = inWd[0]?.id ?? null;
  }

  void load();

  // 工作目录变化：刷新最近工作空间 + 切到该工作空间最近的任务（无任务则空态）
  if (host) {
    watch(
      () => useSettingsStore().settings.workingDirectory,
      async wd => {
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
    recentWorkspaces,
    homeDir,
    refreshWorkspaces,
    activeSession,
    hasMessage,
    filteredSessions,
    workspaceGroups,
    select,
    createSession,
    persistSession,
    persistMessage,
    load
  };
});
