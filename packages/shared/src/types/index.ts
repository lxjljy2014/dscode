import type { SessionStats } from './usage';

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
  /** 用户消息附件（图片预览 / 文件 chip；随消息落库） */
  attachments?: MessageAttachment[];
  /** 用户消息 @ 引用的代码文件（内容随消息落库，历史重建时注入提示词） */
  contexts?: MessageContext[];
  createdAt: number;
}

/** 用户消息附件（图片以 dataUrl 预览；随消息落库，重开恢复展示） */
export interface MessageAttachment {
  id: string;
  /** 文件名（含扩展名） */
  name: string;
  /** 绝对路径（展示用；实际读取由主进程完成） */
  path: string;
  /** MIME 类型（image/* 为图片） */
  mime?: string;
  /** 字节大小 */
  size?: number;
  /** 图片预览 data URL（仅图片且 ≤ 上限时携带） */
  dataUrl?: string;
  /** 文本/代码文件内容（非图片附件读取后携带；注入提示词与折叠展示用） */
  content?: string;
}

/** 用户消息 @ 引用的代码文件（发送时内容注入提示词；随消息落库，历史重建时重新注入） */
export interface MessageContext {
  id: string;
  /** 绝对路径 */
  path: string;
  /** 文件名 */
  name: string;
  /** 文件内容（注入提示词用；随消息落库） */
  content: string;
}

/** 主进程读取附件的返回（区分图片预览与文本内容） */
export type AttachmentReadResult =
  | { ok: true; name: string; path: string; size: number; mime: string; kind: 'image'; dataUrl: string }
  | { ok: true; name: string; path: string; size: number; mime: string; kind: 'text'; text: string }
  | { ok: false; error: string };

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
  usage: { promptTokens: number; completionTokens: number; cachedPromptTokens?: number };
}

/** agent 可调用的工具名 */
export type AgentToolName = 'read_file' | 'list_dir' | 'search' | 'run_command' | 'write_file' | 'edit_file' | 'browse' | 'run_code' | 'skill';

/** 工具结果的结构化内容块（借鉴官方 harness 的 ContentBlock 语义，供 UI 按类型渲染；content 字符串仍是模型可见文本） */
export type ToolContentBlock =
  | { type: 'text'; text: string }
  | { type: 'json'; value: unknown }
  | { type: 'file'; path: string; line?: number }
  | { type: 'diff'; path: string; oldText: string | null; newText: string };

/** 工具事件（聊天流中与消息交错展示） */
export interface AgentToolEvent {
  id: string;
  /** 模型 tool call id（历史重建时对齐运行时上下文，保持前缀缓存稳定；旧数据缺省） */
  toolCallId?: string;
  name: AgentToolName;
  /** 参数 JSON 字符串（原样展示） */
  args: string;
  status: 'running' | 'done' | 'error' | 'confirming' | 'denied';
  /** 结果摘要（截断后的开头部分） */
  summary?: string;
  /** 工具全量输出（仅 done 终态携带；渲染端落库供跨运行历史重建，保持与运行时上下文一致） */
  content?: string;
  /**
   * 结构化结果块（仅 done 终态携带）：UI 按类型渲染（如 read_file 的行视图、run_command 的终端卡）。
   * 与 content 并存——content 是给模型/历史重建的文本，blocks 是给 UI 的结构化展示。
   */
  blocks?: ToolContentBlock[];
  /** 工具私有展示元数据（如 run_command 的退出码），透传给 UI 但不进模型上下文 */
  meta?: Record<string, unknown>;
  /**
   * 工具附加给下一步的模型上下文（如写文件后的小结）：运行时注入为 user 消息；
   * 渲染端落库供跨运行历史重建，保持与运行时上下文一致。
   */
  additionalContexts?: string[];
  /** 工具标记本轮结束（执行完本批工具后不再回模型；如批处理类工具） */
  concludesTurn?: boolean;
  error?: string;
  createdAt: number;
}

/** assistant 输出的有序步骤：正文片段与工具调用交错（随消息 JSON 落库） */
export type AssistantStep =
  | { kind: 'reasoning'; content: string }
  | { kind: 'text'; content: string }
  | { kind: 'tool'; event: AgentToolEvent };

/** agent:start 传入的消息历史（渲染端 → 主进程；与运行时上下文逐字节一致以保证前缀缓存稳定） */
export interface ChatMessagePayload {
  /** tool = 工具执行结果（role:'tool' + tool_call_id，DeepSeek wire 语义） */
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** assistant 带工具调用时重建（content 空串 + tool_calls，与运行时结构一致） */
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  /** tool 消息：对应模型 tool call id */
  tool_call_id?: string;
  /** assistant 工具调用回合回传思维链（DeepSeek thinking passback 规则：仅 tool-call 回合带，纯文本回合省 token 不带） */
  reasoning_content?: string;
}

/** agent:error 事件负载 */
export interface AgentErrorEvent {
  sessionId: string;
  code: 'no-api-key' | 'api' | 'network' | 'aborted' | 'running' | 'max-rounds' | 'unknown';
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
  /** 会话级运行统计（输入卡片下方统计条；随会话 meta 持久化，重开会话恢复展示） */
  stats?: SessionStats;
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
export * from './tray';
export * from './updater';
export * from './usage';