import type { ChatMessagePayload, Message, Session } from '@dscode/shared';

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

/** 校验持久化消息（required + errorCode；streaming/reasoning 为渲染端瞬态字段不落库） */
export function isMessage(v: unknown): v is Message {
  if (!isRecord(v)) return false;
  const r = v as Record<string, unknown>;
  return (
    isString(r['id']) &&
    (r['role'] === 'user' || r['role'] === 'assistant') &&
    isString(r['content']) &&
    typeof r['createdAt'] === 'number' &&
    (r['errorCode'] === undefined || isString(r['errorCode']))
  );
}

/** 校验会话行（toolEvents/messages 由渲染端置空后落库，这里不校验其内容） */
export function isSession(v: unknown): v is Session {
  if (!isRecord(v)) return false;
  const r = v as Record<string, unknown>;
  return (
    isString(r['id']) &&
    isString(r['title']) &&
    typeof r['workingDirectory'] === 'string' &&
    typeof r['createdAt'] === 'number' &&
    typeof r['updatedAt'] === 'number'
  );
}

/** 终端尺寸校验并收窄：cols 2..500 / rows 1..200 的整数 */
export function parseTerminalSize(cols: unknown, rows: unknown): [number, number] | null {
  if (typeof cols !== 'number' || typeof rows !== 'number') return null;
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) return null;
  if (cols < 2 || cols > 500 || rows < 1 || rows > 200) return null;
  return [cols, rows];
}
