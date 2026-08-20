import type { AgentToolEvent, AppSettings, AssistantStep, ChatMessagePayload, Message, Session, SessionStats } from '@dscode/shared';
import { TOOL_NAMES, TOOL_STATUSES } from '@dscode/core';

/**
 * IPC 参数校验的共享收窄函数。
 * 此前各 handler 手写 isString/typeof 校验，重复且易漏（如 sessions:append 只校验 id/content）。
 * 收敛到此处统一 schema，主进程与 agent 壳复用。
 */

export const isString = (v: unknown): v is string => typeof v === 'string';

/** 有限数字（排除 NaN/Infinity，避免污染持久化） */
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** AppSettings 允许经 IPC settings:set 写入的字段白名单（防渲染端注入未知/危险字段） */
const SETTINGS_PATCH_KEYS = new Set<keyof AppSettings>([
  'workingDirectory',
  'permissionMode',
  'providers',
  'onboardingDone',
  'commands',
  'memory',
  'skills',
  'hooks',
  'subagents',
  'mcpServers',
  'browsingEnabled',
  'autoCompact',
  'autoCompactThreshold'
]);

/** 校验 settings:set 的 patch：必须是普通对象且所有 key 都在白名单内（未知 key 一律拒绝） */
export function isSettingsPatch(v: unknown): v is Record<string, unknown> {
  if (!isRecord(v) || Array.isArray(v)) return false;
  return Object.keys(v).every(k => SETTINGS_PATCH_KEYS.has(k as keyof AppSettings));
}

/**
 * 校验 agent:start 传入的历史消息（公共边界的强类型收窄）。
 * user/assistant 可带 tool_calls 重建结构；tool 为执行结果（tool_call_id + content）；
 * assistant 工具调用回合可带 reasoning_content（DeepSeek thinking passback）。
 */
export function isChatMessagePayload(v: unknown): v is ChatMessagePayload {
  if (!isRecord(v)) return false;
  const r = v as Record<string, unknown>;
  if (r['role'] !== 'user' && r['role'] !== 'assistant' && r['role'] !== 'tool') return false;
  if (!isString(r['content'])) return false;
  if (r['reasoning_content'] !== undefined && !isString(r['reasoning_content'])) return false;
  if (r['tool_call_id'] !== undefined && !isString(r['tool_call_id'])) return false;
  if (r['tool_calls'] === undefined) return true;
  if (!Array.isArray(r['tool_calls'])) return false;
  return r['tool_calls'].every(t => {
    if (!isRecord(t)) return false;
    const tc = t as Record<string, unknown>;
    const fn = isRecord(tc['function']) ? (tc['function'] as Record<string, unknown>) : null;
    return isString(tc['id']) && tc['type'] === 'function' && !!fn && isString(fn['name']) && isString(fn['arguments']);
  });
}

/** 校验工具事件（required 字段 + 可选 summary/error 的类型）；工具名/状态取自 core 单一事实源 */
function isToolEvent(v: unknown): v is AgentToolEvent {
  if (!isRecord(v)) return false;
  const r = v as Record<string, unknown>;
  return (
    isString(r['id']) &&
    isString(r['name']) &&
    (TOOL_NAMES as readonly string[]).includes(r['name']) &&
    isString(r['args']) &&
    isString(r['status']) &&
    (TOOL_STATUSES as readonly string[]).includes(r['status']) &&
    isFiniteNumber(r['createdAt']) &&
    (r['toolCallId'] === undefined || isString(r['toolCallId'])) &&
    (r['summary'] === undefined || isString(r['summary'])) &&
    (r['content'] === undefined || isString(r['content'])) &&
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
    isFiniteNumber(r['startAt']) &&
    isFiniteNumber(r['endAt']) &&
    (r['firstTokenMs'] === undefined || isFiniteNumber(r['firstTokenMs'])) &&
    (r['promptTokens'] === undefined || isFiniteNumber(r['promptTokens'])) &&
    (r['completionTokens'] === undefined || isFiniteNumber(r['completionTokens']))
  );
}

/** 校验附件（id/name/path 必填字符串；mime/size/dataUrl 可选） */
function isAttachments(v: unknown): v is Message['attachments'] {
  if (v === undefined) return true;
  if (!Array.isArray(v)) return false;
  return v.every(a => {
    if (!isRecord(a)) return false;
    const r = a as Record<string, unknown>;
    return (
      isString(r['id']) &&
      isString(r['name']) &&
      isString(r['path']) &&
      (r['mime'] === undefined || isString(r['mime'])) &&
      (r['size'] === undefined || typeof r['size'] === 'number') &&
      (r['dataUrl'] === undefined || isString(r['dataUrl'])) &&
      (r['content'] === undefined || isString(r['content']))
    );
  });
}

/** 校验 @ 引用上下文（id/path/name/content 必填字符串） */
function isContexts(v: unknown): v is Message['contexts'] {
  if (v === undefined) return true;
  if (!Array.isArray(v)) return false;
  return v.every(c => {
    if (!isRecord(c)) return false;
    const r = c as Record<string, unknown>;
    return isString(r['id']) && isString(r['path']) && isString(r['name']) && isString(r['content']);
  });
}

/** 校验持久化消息（required + errorCode/steps/stats 可选；streaming/reasoning 顶层字段为渲染端瞬态不落库） */
export function isMessage(v: unknown): v is Message {
  if (!isRecord(v)) return false;
  const r = v as Record<string, unknown>;
  return (
    isString(r['id']) &&
    (r['role'] === 'user' || r['role'] === 'assistant') &&
    isString(r['content']) &&
    isFiniteNumber(r['createdAt']) &&
    (r['errorCode'] === undefined || isString(r['errorCode'])) &&
    (r['steps'] === undefined || isAssistantSteps(r['steps'])) &&
    (r['stats'] === undefined || isMessageStats(r['stats'])) &&
    (r['attachments'] === undefined || isAttachments(r['attachments'])) &&
    (r['contexts'] === undefined || isContexts(r['contexts']))
  );
}

/** 校验会话行（toolEvents/messages 由渲染端置空后落库，这里不校验其内容；archived 可选，缺省未归档） */
/** 会话运行统计收窄（输入卡片下方统计条；字段不全拒绝） */
export function isSessionStats(v: unknown): v is SessionStats {
  if (!isRecord(v)) return false;
  const s = v as Record<string, unknown>;
  return (
    isFiniteNumber(s['rounds']) &&
    isFiniteNumber(s['llmMs']) &&
    isFiniteNumber(s['toolMs']) &&
    isFiniteNumber(s['firstTokenMsSum']) &&
    isFiniteNumber(s['firstTokenCount']) &&
    isFiniteNumber(s['promptTokens']) &&
    isFiniteNumber(s['completionTokens']) &&
    isFiniteNumber(s['cacheHits']) &&
    isFiniteNumber(s['cacheMisses']) &&
    isFiniteNumber(s['cacheHitTokens']) &&
    isFiniteNumber(s['cacheMissTokens']) &&
    (s['contextTokens'] === undefined || isFiniteNumber(s['contextTokens'])) &&
    (s['systemTokens'] === undefined || isFiniteNumber(s['systemTokens'])) &&
    (s['toolsTokens'] === undefined || isFiniteNumber(s['toolsTokens'])) &&
    (s['messagesTokens'] === undefined || isFiniteNumber(s['messagesTokens']))
  );
}

export function isSession(v: unknown): v is Session {
  if (!isRecord(v)) return false;
  const r = v as Record<string, unknown>;
  return (
    isString(r['id']) &&
    isString(r['title']) &&
    typeof r['workingDirectory'] === 'string' &&
    isFiniteNumber(r['createdAt']) &&
    isFiniteNumber(r['updatedAt']) &&
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