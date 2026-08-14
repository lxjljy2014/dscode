export type MessageRole = 'user' | 'assistant';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  /** 流式输出中 */
  streaming?: boolean;
  /** agent 错误码（渲染端映射 i18n 文案） */
  errorCode?: string;
  /** 错误详情（主进程附带的具体原因，仅内存展示，不持久化） */
  errorDetail?: string;
  /** 推理模型的思维链（reasoning_content 流，仅内存展示，不持久化） */
  reasoning?: string;
  /** assistant 输出的有序步骤（正文与工具交错；随消息落库，恢复历史消息时按此重建） */
  steps?: AssistantStep[];
  /** agent 回复的运行统计（仅内存展示，不持久化；旧消息无此字段） */
  stats?: MessageStats;
  createdAt: number;
}

/** 一次 agent 回复的运行统计（仅内存展示，不持久化） */
export interface MessageStats {
  /** 回复开始时间（毫秒时间戳） */
  startAt: number;
  /** 回复结束时间（毫秒时间戳） */
  endAt: number;
  /** 首 token 到达耗时（相对开始，毫秒；无正文输出时缺失） */
  firstTokenMs?: number;
  /** 输入 token 数（运行中断/报错时可能缺失） */
  promptTokens?: number;
  /** 输出 token 数（运行中断/报错时可能缺失） */
  completionTokens?: number;
}

/** agent:usage 事件负载（token 用量，主进程推送） */
export interface AgentUsageEvent {
  sessionId: string;
  usage: { promptTokens: number; completionTokens: number };
}

/** agent 可调用的工具名 */
export type AgentToolName = 'read_file' | 'list_dir' | 'search' | 'run_command' | 'write_file' | 'edit_file' | 'browse';

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

/** assistant 输出的有序步骤：正文片段与工具调用交错（随消息 JSON 落库） */
export type AssistantStep =
  | { kind: 'reasoning'; content: string }
  | { kind: 'text'; content: string }
  | { kind: 'tool'; event: AgentToolEvent };

/** agent:start 传入的消息历史（渲染端 → 主进程） */
export interface ChatMessagePayload {
  role: 'user' | 'assistant';
  content: string;
}

/** agent:error 事件负载 */
export interface AgentErrorEvent {
  sessionId: string;
  code: 'no-api-key' | 'api' | 'network' | 'aborted' | 'running' | 'unknown';
  detail?: string;
}

/** agent:confirm 确认请求负载 */
export interface AgentConfirmRequest {
  sessionId: string;
  toolEventId: string;
  name: AgentToolName;
  args: string;
}

/**
 * 工具确认决策（覆盖输入框的确认卡片三选项）：
 * - allow-once：仅本次放行
 * - allow-session：本会话内相同签名不再询问
 * - deny：拒绝并停止整个任务
 */
export type ConfirmDecision = { kind: 'allow-once' } | { kind: 'allow-session' } | { kind: 'deny' };

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
  /** 已归档（侧边栏收进「已归档」区；旧数据无此字段视为未归档） */
  archived?: boolean;
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
