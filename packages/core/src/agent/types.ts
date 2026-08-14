import type { AgentErrorEvent, AgentToolEvent, AgentToolName, DiffFile } from '@dscode/shared';

/**
 * agent 事件接收方：宿主各自实现。
 * desktop 经 IPC 推给渲染端；将来的 TUI 端直接输出终端渲染，复用同一套运行时。
 */
export interface AgentEventSink {
  /** 流式文本增量（kind: content 正文 / reasoning 思维链） */
  delta(sessionId: string, kind: 'content' | 'reasoning', content: string): void;
  /** 工具事件（状态流转，同一 toolEventId 多次推送） */
  tool(sessionId: string, event: AgentToolEvent): void;
  /** 写/执行确认请求 */
  confirm(sessionId: string, toolEventId: string, name: AgentToolName, args: string): void;
  /** 本轮运行结束 */
  done(sessionId: string): void;
  /** 运行错误 */
  error(sessionId: string, code: AgentErrorEvent['code'], detail?: string): void;
  /** 写/执行工具后的 diff 推送 */
  diff(sessionId: string, files: DiffFile[]): void;
}
