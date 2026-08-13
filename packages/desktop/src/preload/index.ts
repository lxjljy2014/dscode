import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppSettings,
  GitGraphResult,
  GitListResult,
  GitOpResult,
  ProjectsListResult,
  ProviderVerifyResult,
  SettingsPatch,
  TerminalDataEvent,
  TerminalEnsureResult,
  TerminalExitInfo
} from '@dscode/shared';

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
