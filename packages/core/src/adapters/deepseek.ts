import { openAiCompatibleAdapter, parseOpenAiDelta } from './openai-compatible';
import type { ModelAdapter, NormalizedDelta } from './types';

/**
 * DeepSeek 适配器：协议与 OpenAI 兼容一致，差异仅在推理模型的思维链增量
 * 使用 reasoning_content 字段（deepseek-v4-pro 等）。
 */
export const deepseekAdapter: ModelAdapter = {
  ...openAiCompatibleAdapter,
  id: 'deepseek',
  parseDelta(data: string): NormalizedDelta | null | undefined {
    if (data === '[DONE]') return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return undefined;
    }
    const base = parseOpenAiDelta(parsed);
    const delta = (parsed as { choices?: Array<{ delta?: Record<string, unknown> }> }).choices?.[0]?.delta;
    const reasoning = typeof delta?.['reasoning_content'] === 'string' ? delta['reasoning_content'] : '';
    if (!base && reasoning.length === 0) return undefined;
    return { ...base, ...(reasoning.length > 0 ? { reasoning } : {}) };
  }
};
