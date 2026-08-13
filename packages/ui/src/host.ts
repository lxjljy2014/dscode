import type {
  AppSettings,
  GitGraphResult,
  GitListResult,
  GitOpResult,
  ProjectsListResult,
  SettingsPatch,
  TerminalDataEvent,
  TerminalEnsureResult,
  TerminalExitInfo
} from '@dscode/shared';

/**
 * 宿主（Electron preload）注入到 window.dscode 的桥接 API。
 * 纯浏览器环境下为 undefined，组件需做降级处理。
 */

export interface TitleBarOverlayOptions {
  /** 按钮符号色（背景色固定为透明，不随主题变化） */
  symbolColor: string;
}

export interface HostApi {
  platform: string;
  versions: Record<string, string | undefined>;
  setTitleBarOverlay: (options: TitleBarOverlayOptions) => void;

  // ---- settings ----
  getSettings: () => Promise<AppSettings>;
  setSettings: (patch: SettingsPatch) => Promise<AppSettings>;

  // ---- 最近项目 / 目录选择 ----
  listRecentProjects: () => Promise<ProjectsListResult>;
  pickDirectory: () => Promise<string | null>;

  // ---- git ----
  gitListBranches: (cwd: string) => Promise<GitListResult>;
  gitCheckout: (cwd: string, branch: string) => Promise<GitOpResult>;
  gitCreateBranch: (cwd: string, name: string) => Promise<GitOpResult>;
  gitGraph: (cwd: string) => Promise<GitGraphResult>;

  // ---- 终端 ----
  terminalEnsure: (sessionId: string, cwd: string) => Promise<TerminalEnsureResult>;
  terminalWrite: (sessionId: string, data: string) => void;
  terminalResize: (sessionId: string, cols: number, rows: number) => void;
  terminalKill: (sessionId: string) => Promise<void>;
  /** 订阅终端数据/退出事件（按 sessionId 分发），均返回取消订阅函数 */
  onTerminalData: (cb: (ev: TerminalDataEvent) => void) => () => void;
  onTerminalExit: (cb: (info: TerminalExitInfo) => void) => () => void;
}

declare global {
  interface Window {
    dscode?: HostApi;
  }
}

export const host: HostApi | undefined = typeof window === 'undefined' ? undefined : window.dscode;

export const isMac = host?.platform === 'darwin';

/** 是否处于无边框窗口环境（Electron），决定拖拽区与标题栏悬浮控件的占位 */
export const isFrameless = host !== undefined;

/** Windows 原生悬浮按钮占用 header 右侧的宽度（3 个按钮，每个约 46px） */
export const TITLEBAR_OVERLAY_WIDTH = 150;
