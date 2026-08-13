import { contextBridge, ipcRenderer } from 'electron';
import type {
  AgentConfirmRequest,
  AgentErrorEvent,
  AppSettings,
  ChatMessagePayload,
  DiffFile,
  FileNode,
  GitGraphResult,
  GitListResult,
  GitOpResult,
  Message,
  ProjectsListResult,
  ProviderVerifyResult,
  Session,
  SettingsPatch,
  TerminalDataEvent,
  TerminalEnsureResult,
  TerminalExitInfo
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
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:pick-directory'),

  // ---- 供应商校验 ----
  verifyProvider: (baseUrl: string, apiKey: string): Promise<ProviderVerifyResult> =>
    ipcRenderer.invoke('provider:verify', baseUrl, apiKey),

  // ---- agent ----
  agentStart: (sessionId: string, model: string, messages: ChatMessagePayload[]): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('agent:start', sessionId, model, messages),
  agentStop: (sessionId: string): Promise<void> => ipcRenderer.invoke('agent:stop', sessionId),
  agentConfirmResponse: (toolEventId: string, approve: boolean): Promise<void> =>
    ipcRenderer.invoke('agent:confirm-response', toolEventId, approve),
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
  onAgentTool: (cb: (ev: { sessionId: string; event: import('@dscode/shared').AgentToolEvent }) => void): (() => void) =>
    subscribe('agent:tool', cb, raw => hasSessionId(raw) && typeof raw['event'] === 'object' && raw['event'] !== null),
  /** 订阅写/执行工具确认请求 */
  onAgentConfirm: (cb: (ev: AgentConfirmRequest) => void): (() => void) =>
    subscribe('agent:confirm', cb, raw => hasSessionId(raw) && typeof raw['toolEventId'] === 'string'),
  /** 订阅 agent 完成事件 */
  onAgentDone: (cb: (ev: { sessionId: string }) => void): (() => void) =>
    subscribe('agent:done', cb, hasSessionId),
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
  }
};

export type DsCodeApi = typeof api;

contextBridge.exposeInMainWorld('dscode', api);
