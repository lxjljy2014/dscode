import { app } from 'electron';
import {
  applyCompaction,
  buildCompactionRequest,
  listSessions,
  resolveAdapter,
  rewriteSessionMessages,
  selectCompactableRange,
  streamChatWithRetry
} from '@dscode/core';
import type { Message } from '@dscode/shared';
import { loadAppSettings } from './settings';
import { getConfigDir, getSessionsDir } from './data-dir';

/** 摘要 LLM 调用超时（毫秒） */
const COMPACT_TIMEOUT_MS = 120_000;

/**
 * 执行一次会话压缩：把较旧的一段对话浓缩为结构化检查点，替换旧消息并落盘。
 * 返回压缩后的完整消息列表，供渲染端更新内存态。
 */
export async function compactSession(
  sessionId: string
): Promise<{ ok: true; messages: Message[] } | { ok: false; error: string }> {
  const settings = loadAppSettings(getConfigDir(), app.getPath('home'));
  const provider = settings.providers[0];
  if (!provider || provider.apiKey.length === 0 || provider.models.length === 0) {
    return { ok: false, error: '未配置供应商或模型' };
  }
  const session = listSessions(getSessionsDir()).find(s => s.id === sessionId);
  if (!session) return { ok: false, error: '会话不存在' };

  const range = selectCompactableRange(session.messages);
  if (!range) return { ok: false, error: '没有可压缩的历史' };

  const request = buildCompactionRequest(session.messages, range);
  const model = provider.models[0];

  let summary = '';
  try {
    await streamChatWithRetry(
      resolveAdapter(provider.adapter),
      {
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model,
        messages: request,
        tools: [],
        thinking: false,
        maxTokens: provider.maxTokens
      },
      AbortSignal.timeout(COMPACT_TIMEOUT_MS),
      text => {
        summary += text;
      },
      () => {}
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  summary = summary.trim();
  if (summary.length === 0) return { ok: false, error: '摘要为空' };

  const checkpointId = `m-compact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const messages = applyCompaction(session.messages, range, summary, checkpointId);
  rewriteSessionMessages(getSessionsDir(), sessionId, messages);
  return { ok: true, messages };
}
