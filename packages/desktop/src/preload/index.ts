import { contextBridge, ipcRenderer } from 'electron';
import type {
  AgentConfirmRequest,
  AgentErrorEvent,
  ConfirmDecision,
  AppSettings,
  AttachmentReadResult,
  ChatMessagePayload,
  DiffFile,
  FileNode,
  GitGraphResult,
  GitListResult,
  GitOpResult,
  IndexSearchHit,
  IndexStats,
  LlmCacheStats,
  McpListToolsResult,
  Message,
  Plugin,
  ProjectsListResult,
  ProviderVerifyResult,
  Session,
  SessionStats,
  SettingsPatch,
  TerminalDataEvent,
  TerminalEnsureResult,
  TerminalExitInfo,
  TrayAction,
  UpdaterState,
  UsageRecord
} from '@dscode/shared';

/** 通用事件订阅包装：字段校验 + 返回取消订阅函数 */
function subscribe<T extends { sessionId: string }>(
  channel: string,
  cb: (ev: T) => void,
  validate: (raw: Record<string, unknown>) => boolean
): () => void {
  const listener = (_e: Electron.IpcRendererEvent, ev: unknown): void => {
    if (typeof ev === 'object' && ev !== null && validate(ev as Record<string, unknown>)) {
      cb(ev as T);
    }
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

function hasSessionId(raw: Record<string, unknown>): boolean {
  return typeof raw['sessionId'] === 'string';
}

const api = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },
  /** 同步 Windows 原生标题栏悬浮按钮的符号色（主题切换时调用；背景色固定透明） */
  setTitleBarOverlay: (options: { symbolColor: string }) => ipcRenderer.send('win:set-titlebar-overlay', options),

  // ---- settings ----
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: SettingsPatch): Promise<AppSettings> => ipcRenderer.invoke('settings:set', patch),

  // ---- 最近项目 / 目录选择 ----
  listRecentProjects: (): Promise<ProjectsListResult> => ipcRenderer.invoke('projects:list'),
  removeRecentProject: (path: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('projects:remove', path),
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:pick-directory'),
  pickFiles: (): Promise<string[] | null> => ipcRenderer.invoke('dialog:pick-files'),
  readAttachment: (path: string): Promise<AttachmentReadResult> => ipcRenderer.invoke('attachment:read', path),
  saveFile: (
    defaultName: string,
    content: string
  ): Promise<{ ok: true } | { ok: false; canceled?: boolean; error?: string }> =>
    ipcRenderer.invoke('dialog:save-file', defaultName, content),

  // ---- 供应商校验 ----
  verifyProvider: (baseUrl: string, apiKey: string): Promise<ProviderVerifyResult> =>
    ipcRenderer.invoke('provider:verify', baseUrl, apiKey),

  // ---- agent ----
  agentStart: (
    sessionId: string,
    model: string,
    messages: ChatMessagePayload[],
    subagentId: string,
    reasoningEffort?: 'off' | 'high' | 'max'
  ): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('agent:start', sessionId, model, messages, subagentId, reasoningEffort),
  agentStop: (sessionId: string): Promise<void> => ipcRenderer.invoke('agent:stop', sessionId),
  agentConfirmResponse: (toolEventId: string, decision: ConfirmDecision): Promise<void> =>
    ipcRenderer.invoke('agent:confirm-response', toolEventId, decision),
  /** 订阅 agent 文本增量（kind: content=正文 / reasoning=思维链） */
  onAgentDelta: (
    cb: (ev: { sessionId: string; content: string; kind: 'content' | 'reasoning' }) => void
  ): (() => void) =>
    subscribe(
      'agent:delta',
      cb,
      raw =>
        hasSessionId(raw) &&
        typeof raw['content'] === 'string' &&
        (raw['kind'] === undefined || raw['kind'] === 'content' || raw['kind'] === 'reasoning')
    ),
  /** 订阅 agent 工具事件（状态流转） */
  onAgentTool: (
    cb: (ev: { sessionId: string; event: import('@dscode/shared').AgentToolEvent }) => void
  ): (() => void) =>
    subscribe('agent:tool', cb, raw => hasSessionId(raw) && typeof raw['event'] === 'object' && raw['event'] !== null),
  /** 订阅写/执行工具确认请求 */
  onAgentConfirm: (cb: (ev: AgentConfirmRequest) => void): (() => void) =>
    subscribe('agent:confirm', cb, raw => hasSessionId(raw) && typeof raw['toolEventId'] === 'string'),
  /** 订阅 agent 完成事件 */
  onAgentDone: (cb: (ev: { sessionId: string }) => void): (() => void) => subscribe('agent:done', cb, hasSessionId),
  /** 订阅会话级运行统计（输入卡片下方统计条） */
  onSessionStats: (cb: (ev: { sessionId: string; stats: SessionStats }) => void): (() => void) =>
    subscribe(
      'agent:session-stats',
      cb,
      raw => hasSessionId(raw) && typeof raw['stats'] === 'object' && raw['stats'] !== null
    ),
  /** 订阅 agent token 用量事件（回复底部统计；usage 为 { promptTokens, completionTokens }） */
  onAgentUsage: (
    cb: (ev: { sessionId: string; usage: { promptTokens: number; completionTokens: number } }) => void
  ): (() => void) =>
    subscribe('agent:usage', cb, raw => hasSessionId(raw) && typeof raw['usage'] === 'object' && raw['usage'] !== null),
  /** 订阅 agent 错误事件 */
  onAgentError: (cb: (ev: AgentErrorEvent) => void): (() => void) =>
    subscribe('agent:error', cb, raw => hasSessionId(raw) && typeof raw['code'] === 'string'),
  /** 订阅工作区 diff 更新（写/执行工具后主进程推送） */
  onWorkspaceDiff: (cb: (ev: { sessionId: string; files: DiffFile[] }) => void): (() => void) =>
    subscribe('workspace:diff', cb, raw => hasSessionId(raw) && Array.isArray(raw['files'])),

  // ---- 工作区 ----
  workspaceTree: (): Promise<FileNode[]> => ipcRenderer.invoke('workspace:tree'),
  workspaceReadFile: (relPath: string): Promise<{ ok: true; content: string } | { ok: false; error: string }> =>
    ipcRenderer.invoke('workspace:read-file', relPath),

  // ---- 会话持久化 ----
  sessionsList: (): Promise<Session[]> => ipcRenderer.invoke('sessions:list'),
  sessionsCreate: (session: Session): Promise<{ ok: boolean }> => ipcRenderer.invoke('sessions:create', session),
  sessionsAppend: (sessionId: string, message: Message): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('sessions:append', sessionId, message),
  sessionSetArchived: (sessionId: string, archived: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('sessions:archive', sessionId, archived),
  sessionsStats: (sessionId: string, stats: SessionStats): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('sessions:stats', sessionId, stats),

  // ---- 使用统计 ----
  usageList: (): Promise<UsageRecord[]> => ipcRenderer.invoke('usage:list'),
  /** LLM 回复缓存统计（命中率/节省 token） */
  cacheStats: (): Promise<LlmCacheStats> => ipcRenderer.invoke('usage:cache-stats'),
  /** 清空 LLM 回复缓存，返回清空后的统计 */
  cacheClear: (): Promise<LlmCacheStats> => ipcRenderer.invoke('usage:cache-clear'),

  // ---- MCP ----
  listMcpTools: (command: string, args: string[]): Promise<McpListToolsResult> =>
    ipcRenderer.invoke('mcp:list-tools', command, args),

  // ---- 插件 ----
  pluginsList: (): Promise<Plugin[]> => ipcRenderer.invoke('plugins:list'),

  // ---- 代码索引 ----
  indexStats: (): Promise<IndexStats> => ipcRenderer.invoke('index:stats'),
  indexBuild: (): Promise<IndexStats> => ipcRenderer.invoke('index:build'),
  indexSearch: (query: string): Promise<IndexSearchHit[]> => ipcRenderer.invoke('index:search', query),

  // ---- 浏览器 ----
  browserFetch: (url: string): Promise<{ ok: true; content: string } | { ok: false; error: string }> =>
    ipcRenderer.invoke('browser:fetch', url),

  // ---- git ----
  gitListBranches: (cwd: string): Promise<GitListResult> => ipcRenderer.invoke('git:list-branches', cwd),
  gitCheckout: (cwd: string, branch: string): Promise<GitOpResult> => ipcRenderer.invoke('git:checkout', cwd, branch),
  gitCreateBranch: (cwd: string, name: string): Promise<GitOpResult> =>
    ipcRenderer.invoke('git:create-branch', cwd, name),
  gitGraph: (cwd: string): Promise<GitGraphResult> => ipcRenderer.invoke('git:graph', cwd),

  // ---- 终端 ----
  terminalEnsure: (sessionId: string, cwd: string): Promise<TerminalEnsureResult> =>
    ipcRenderer.invoke('terminal:ensure', sessionId, cwd),
  terminalWrite: (sessionId: string, data: string): void => ipcRenderer.send('terminal:write', sessionId, data),
  terminalResize: (sessionId: string, cols: number, rows: number): void =>
    ipcRenderer.send('terminal:resize', sessionId, cols, rows),
  terminalKill: (sessionId: string): Promise<void> => ipcRenderer.invoke('terminal:kill', sessionId),
  /** 订阅终端数据事件（按 sessionId 分发），返回取消订阅函数 */
  onTerminalData: (cb: (ev: TerminalDataEvent) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, ev: unknown): void => {
      if (
        typeof ev === 'object' &&
        ev !== null &&
        typeof (ev as Record<string, unknown>)['sessionId'] === 'string' &&
        typeof (ev as Record<string, unknown>)['data'] === 'string'
      ) {
        cb(ev as TerminalDataEvent);
      }
    };
    ipcRenderer.on('terminal:data', listener);
    return () => ipcRenderer.removeListener('terminal:data', listener);
  },
  /** 订阅终端退出事件（按 sessionId 分发），返回取消订阅函数 */
  onTerminalExit: (cb: (info: TerminalExitInfo) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, info: unknown): void => {
      if (
        typeof info === 'object' &&
        info !== null &&
        typeof (info as Record<string, unknown>)['sessionId'] === 'string' &&
        typeof (info as Record<string, unknown>)['exitCode'] === 'number'
      ) {
        cb(info as TerminalExitInfo);
      }
    };
    ipcRenderer.on('terminal:exit', listener);
    return () => ipcRenderer.removeListener('terminal:exit', listener);
  },

  // ---- 系统托盘 ----
  /** 订阅托盘菜单动作（新建会话/打开设置/切换工作空间），返回取消订阅函数 */
  onTrayAction: (cb: (ev: TrayAction) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, ev: unknown): void => {
      if (typeof ev === 'object' && ev !== null && typeof (ev as Record<string, unknown>)['action'] === 'string') {
        cb(ev as TrayAction);
      }
    };
    ipcRenderer.on('tray:action', listener);
    return () => ipcRenderer.removeListener('tray:action', listener);
  },

  // ---- 自动更新 ----
  /** 订阅自动更新状态（驱动侧边栏更新按钮），返回取消订阅函数 */
  onUpdaterState: (cb: (state: UpdaterState) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, state: unknown): void => {
      if (typeof state === 'object' && state !== null && typeof (state as Record<string, unknown>)['state'] === 'string') {
        cb(state as UpdaterState);
      }
    };
    ipcRenderer.on('updater:state', listener);
    return () => ipcRenderer.removeListener('updater:state', listener);
  },
  /** 触发下载更新（用户点击「更新」按钮） */
  updaterDownload: (): Promise<void> => ipcRenderer.invoke('updater:download'),
  /** 重启并安装已下载的更新（用户点击「重启更新」按钮） */
  updaterInstall: (): Promise<void> => ipcRenderer.invoke('updater:install'),
  /** 拉取当前更新状态（渲染端加载时同步一次） */
  updaterGetState: (): Promise<UpdaterState> => ipcRenderer.invoke('updater:get-state')
};

export type DsCodeApi = typeof api;

contextBridge.exposeInMainWorld('dscode', api);