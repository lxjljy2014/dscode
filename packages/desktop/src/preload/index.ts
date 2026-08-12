import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, GitGraphResult, GitListResult, GitOpResult, ProjectsListResult, SettingsPatch } from '@dscode/shared';

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

  // ---- git ----
  gitListBranches: (cwd: string): Promise<GitListResult> => ipcRenderer.invoke('git:list-branches', cwd),
  gitCheckout: (cwd: string, branch: string): Promise<GitOpResult> => ipcRenderer.invoke('git:checkout', cwd, branch),
  gitCreateBranch: (cwd: string, name: string): Promise<GitOpResult> => ipcRenderer.invoke('git:create-branch', cwd, name),
  gitGraph: (cwd: string): Promise<GitGraphResult> => ipcRenderer.invoke('git:graph', cwd)
};

export type DsCodeApi = typeof api;

contextBridge.exposeInMainWorld('dscode', api);
