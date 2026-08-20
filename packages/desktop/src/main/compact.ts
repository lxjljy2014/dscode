import { app } from 'electron';
import {
  applyCompaction,
  buildCompactionRequest,
  estimateContextProjection,
  listSessions,
  resolveAdapter,
  rewriteSessionMessages,
  selectCompactableRange,
  setSessionStats,
  getSessionStats,
  streamChatWithRetry,
  toolSchemas,
  type ContextProjection
} from '@dscode/core';
import type { Message, SessionStats } from '@dscode/shared';
import { loadAppSettings } from './settings';
import { buildAgentSystemPrompt } from './agent/agent';
import { getConfigDir, getSessionsDir } from './data-dir';

/** 摘要 LLM 调用超时（毫秒） */
const COMPACT_TIMEOUT_MS = 120_000;

/**
 * 执行一次会话压缩：把较旧的一段对话浓缩为结构化检查点，替换旧消息并落盘。
 * 返回压缩后的完整消息列表与新上下文占用投影，供渲染端更新内存态与 ContextMeter。
 */
export async function compactSession(
  sessionId: string
): Promise<
  | { ok: true; messages: Message[]; context: ContextProjection }
  | { ok: false; error: string }
> {
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

  // 压缩后的上下文占用：用与真实运行同口径的估算刷新投影，并写入会话统计——
  // 既让 ContextMeter 立即回落，也把下次运行「锚定投影」的起点换到新值（否则按旧锚点高估）
  const context = estimateContextProjection(
    buildAgentSystemPrompt(settings),
    toolSchemas(settings.browsingEnabled, false, settings.skills.length > 0),
    messages
  );
  setSessionStats(getSessionsDir(), sessionId, {
    ...(statsWithZeroBase(getSessionStats(getSessionsDir(), sessionId))),
    ...context
  });
  return { ok: true, messages, context };
}

/** 无历史统计时的零值基底（压缩只覆盖 context 四项，累计值保留） */
function statsWithZeroBase(stats: SessionStats | undefined): SessionStats {
  return (
    stats ?? {
      rounds: 0,
      llmMs: 0,
      toolMs: 0,
      firstTokenMsSum: 0,
      firstTokenCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 0
    }
  );
}
