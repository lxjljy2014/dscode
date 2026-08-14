export type MessageRole = 'user' | 'assistant';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  /** 流式输出中 */
  streaming?: boolean;
  /** agent 错误码（渲染端映射 i18n 文案） */
  errorCode?: string;
  /** 推理模型的思维链（reasoning_content 流，仅内存展示，不持久化） */
  reasoning?: string;
  createdAt: number;
}

/** agent 可调用的工具名 */
export type AgentToolName =
  | 'read_file'
  | 'list_dir'
  | 'search'
  | 'run_command'
  | 'write_file'
  | 'edit_file'
  | 'browse';

/** 工具事件（聊天流中与消息交错展示） */
export interface AgentToolEvent {
  id: string;
  name: AgentToolName;
  /** 参数 JSON 字符串（原样展示） */
  args: string;
  status: 'running' | 'done' | 'error' | 'confirming' | 'denied';
  /** 结果摘要（截断后的开头部分） */
  summary?: string;
  error?: string;
  createdAt: number;
}

/** agent:start 传入的消息历史（渲染端 → 主进程） */
export interface ChatMessagePayload {
  role: 'user' | 'assistant';
  content: string;
}

/** agent:error 事件负载 */
export interface AgentErrorEvent {
  sessionId: string;
  code: 'no-api-key' | 'api' | 'network' | 'aborted' | 'unknown';
  detail?: string;
}

/** agent:confirm 确认请求负载 */
export interface AgentConfirmRequest {
  sessionId: string;
  toolEventId: string;
  name: AgentToolName;
  args: string;
}

export interface Session {
  id: string;
  title: string;
  /** 所属工作空间（创建时的 workingDirectory），侧边栏按此分组 */
  workingDirectory: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  /** 会话内的工具事件（瞬态展示，不持久化） */
  toolEvents: AgentToolEvent[];
}

export type DiffLineType = 'add' | 'del' | 'context' | 'hunk';

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
  /** 相对快照为新增/已删除的文件（渲染端显示标记） */
  status?: 'new' | 'deleted';
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileNode[];
  content?: string;
}

export * from './code-index';
export * from './git';
export * from './mcp';
export * from './projects';
export * from './settings';
export * from './terminal';
export * from './usage';
