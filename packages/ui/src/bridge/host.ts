import type {
  AgentConfirmRequest,
  AgentErrorEvent,
  ConfirmDecision,
  AgentToolEvent,
  AgentUsageEvent,
  AppSettings,
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
  UsageRecord
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
  removeRecentProject: (path: string) => Promise<{ ok: boolean }>;
  pickDirectory: () => Promise<string | null>;

  // ---- 供应商校验 ----
  verifyProvider: (baseUrl: string, apiKey: string) => Promise<ProviderVerifyResult>;

  // ---- agent ----
  agentStart: (
    sessionId: string,
    model: string,
    messages: ChatMessagePayload[],
    subagentId: string
  ) => Promise<{ ok: boolean }>;
  agentStop: (sessionId: string) => Promise<void>;
  agentConfirmResponse: (toolEventId: string, decision: ConfirmDecision) => Promise<void>;
  /** 订阅 agent 事件（按 sessionId 分发），均返回取消订阅函数 */
  onAgentDelta: (cb: (ev: { sessionId: string; content: string; kind: 'content' | 'reasoning' }) => void) => () => void;
  onAgentTool: (cb: (ev: { sessionId: string; event: AgentToolEvent }) => void) => () => void;
  onAgentConfirm: (cb: (ev: AgentConfirmRequest) => void) => () => void;
  onAgentDone: (cb: (ev: { sessionId: string }) => void) => () => void;
  /** 订阅会话级运行统计（输入卡片下方统计条） */
  onSessionStats: (cb: (ev: { sessionId: string; stats: SessionStats }) => void) => () => void;
  onAgentError: (cb: (ev: AgentErrorEvent) => void) => () => void;
  /** 订阅 agent token 用量事件（回复底部统计：首token/token 速率） */
  onAgentUsage: (cb: (ev: AgentUsageEvent) => void) => () => void;
  onWorkspaceDiff: (cb: (ev: { sessionId: string; files: DiffFile[] }) => void) => () => void;

  // ---- 工作区 ----
  workspaceTree: () => Promise<FileNode[]>;
  workspaceReadFile: (relPath: string) => Promise<{ ok: true; content: string } | { ok: false; error: string }>;

  // ---- 会话持久化 ----
  sessionsList: () => Promise<Session[]>;
  sessionsCreate: (session: Session) => Promise<{ ok: boolean }>;
  sessionsAppend: (sessionId: string, message: Message) => Promise<{ ok: boolean }>;
  /** 归档/恢复会话（archived=true 归档；false 恢复） */
  sessionSetArchived: (sessionId: string, archived: boolean) => Promise<{ ok: boolean }>;

  // ---- 使用统计 ----
  usageList: () => Promise<UsageRecord[]>;
  /** LLM 回复缓存统计（命中率/节省 token） */
  cacheStats: () => Promise<LlmCacheStats>;
  /** 清空 LLM 回复缓存，返回清空后的统计 */
  cacheClear: () => Promise<LlmCacheStats>;

  // ---- MCP ----
  listMcpTools: (command: string, args: string[]) => Promise<McpListToolsResult>;

  // ---- 插件 ----
  pluginsList: () => Promise<Plugin[]>;

  // ---- 代码索引 ----
  indexStats: () => Promise<IndexStats>;
  indexBuild: () => Promise<IndexStats>;
  indexSearch: (query: string) => Promise<IndexSearchHit[]>;

  // ---- 浏览器 ----
  browserFetch: (url: string) => Promise<{ ok: true; content: string } | { ok: false; error: string }>;

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
