import type { AgentToolEvent, AssistantStep, ChatMessagePayload, Message, Session } from '@dscode/shared';

/**
 * IPC 参数校验的共享收窄函数。
 * 此前各 handler 手写 isString/typeof 校验，重复且易漏（如 sessions:append 只校验 id/content）。
 * 收敛到此处统一 schema，主进程与 agent 壳复用。
 */

export const isString = (v: unknown): v is string => typeof v === 'string';

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** 校验 agent:start 传入的历史消息（公共边界的强类型收窄） */
export function isChatMessagePayload(v: unknown): v is ChatMessagePayload {
  if (!isRecord(v)) return false;
  const r = v as Record<string, unknown>;
  return (r['role'] === 'user' || r['role'] === 'assistant') && isString(r['content']);
}

const TOOL_NAMES = new Set(['read_file', 'list_dir', 'search', 'run_command', 'write_file', 'edit_file', 'browse']);
const TOOL_STATUSES = new Set(['running', 'done', 'error', 'confirming', 'denied']);

/** 校验工具事件（required 字段 + 可选 summary/error 的类型） */
function isToolEvent(v: unknown): v is AgentToolEvent {
  if (!isRecord(v)) return false;
  const r = v as Record<string, unknown>;
  return (
    isString(r['id']) &&
    isString(r['name']) &&
    TOOL_NAMES.has(r['name']) &&
    isString(r['args']) &&
    isString(r['status']) &&
    TOOL_STATUSES.has(r['status']) &&
    typeof r['createdAt'] === 'number' &&
    (r['summary'] === undefined || isString(r['summary'])) &&
    (r['error'] === undefined || isString(r['error']))
  );
}

/** 校验消息步骤（reasoning/text 带字符串 content；tool 带完整事件），非法项整体拒绝 */
function isAssistantSteps(v: unknown): v is AssistantStep[] {
  if (!Array.isArray(v)) return false;
  return v.every(s => {
    if (!isRecord(s)) return false;
    const r = s as Record<string, unknown>;
    if (r['kind'] === 'reasoning' || r['kind'] === 'text') return isString(r['content']);
    if (r['kind'] === 'tool') return isToolEvent(r['event']);
    return false;
  });
}

/** 校验消息运行统计（startAt/endAt 必填，firstTokenMs/promptTokens/completionTokens 可选数字） */
function isMessageStats(v: unknown): v is Message['stats'] {
  if (!isRecord(v)) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['startAt'] === 'number' &&
    typeof r['endAt'] === 'number' &&
    (r['firstTokenMs'] === undefined || typeof r['firstTokenMs'] === 'number') &&
    (r['promptTokens'] === undefined || typeof r['promptTokens'] === 'number') &&
    (r['completionTokens'] === undefined || typeof r['completionTokens'] === 'number')
  );
}

/** 校验持久化消息（required + errorCode/steps/stats 可选；streaming/reasoning 顶层字段为渲染端瞬态不落库） */
export function isMessage(v: unknown): v is Message {
  if (!isRecord(v)) return false;
  const r = v as Record<string, unknown>;
  return (
    isString(r['id']) &&
    (r['role'] === 'user' || r['role'] === 'assistant') &&
    isString(r['content']) &&
    typeof r['createdAt'] === 'number' &&
    (r['errorCode'] === undefined || isString(r['errorCode'])) &&
    (r['steps'] === undefined || isAssistantSteps(r['steps'])) &&
    (r['stats'] === undefined || isMessageStats(r['stats']))
  );
}

/** 校验会话行（toolEvents/messages 由渲染端置空后落库，这里不校验其内容；archived 可选，缺省未归档） */
export function isSession(v: unknown): v is Session {
  if (!isRecord(v)) return false;
  const r = v as Record<string, unknown>;
  return (
    isString(r['id']) &&
    isString(r['title']) &&
    typeof r['workingDirectory'] === 'string' &&
    typeof r['createdAt'] === 'number' &&
    typeof r['updatedAt'] === 'number' &&
    (r['archived'] === undefined || typeof r['archived'] === 'boolean')
  );
}

/** 终端尺寸校验并收窄：cols 2..500 / rows 1..200 的整数 */
export function parseTerminalSize(cols: unknown, rows: unknown): [number, number] | null {
  if (typeof cols !== 'number' || typeof rows !== 'number') return null;
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) return null;
  if (cols < 2 || cols > 500 || rows < 1 || rows > 200) return null;
  return [cols, rows];
}
