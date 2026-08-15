import type { ChatRequest, ChatRequestInput, ModelAdapter, NormalizedDelta } from './types';

/**
 * 解析 OpenAI 兼容格式的 choices[0].delta → 归一化增量。
 * 导出为共享辅助：deepseek 等衍生适配器在覆写 parseDelta 时复用。
 */
export function parseOpenAiDelta(parsed: unknown): NormalizedDelta | undefined {
  const obj = parsed as {
    choices?: Array<{ delta?: Record<string, unknown> }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_cache_hit_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
  };
  const delta = obj.choices?.[0]?.delta;
  const out: NormalizedDelta = {};
  const u = obj.usage;
  if (u && typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number') {
    // 前缀缓存命中（context caching）：DeepSeek 旧字段 prompt_cache_hit_tokens，OpenAI/新 DeepSeek 用 prompt_tokens_details.cached_tokens
    const cached =
      typeof u.prompt_cache_hit_tokens === 'number'
        ? u.prompt_cache_hit_tokens
        : typeof u.prompt_tokens_details?.cached_tokens === 'number'
          ? u.prompt_tokens_details.cached_tokens
          : undefined;
    out.usage = {
      promptTokens: u.prompt_tokens,
      completionTokens: u.completion_tokens,
      ...(cached !== undefined ? { cachedPromptTokens: cached } : {})
    };
  }
  if (delta) {
    if (typeof delta['content'] === 'string' && delta['content'].length > 0) out.content = delta['content'];
    const calls = delta['tool_calls'];
    if (Array.isArray(calls)) {
      out.toolCalls = (calls as Array<Record<string, unknown>>).map(raw => {
        const fn = (raw['function'] ?? {}) as Record<string, unknown>;
        return {
          index: typeof raw['index'] === 'number' ? raw['index'] : -1,
          id: typeof raw['id'] === 'string' ? raw['id'] : undefined,
          name: typeof fn['name'] === 'string' ? fn['name'] : undefined,
          arguments: typeof fn['arguments'] === 'string' ? fn['arguments'] : undefined
        };
      });
    }
  }
  if (!out.content && !out.toolCalls && !out.usage) return undefined;
  return out;
}

/**
 * DeepSeek 推理语义（对齐官方 harness serialize.ts 的 resolveThinking）：
 * - effort off → thinking disabled（reasoning_effort 不上线，模型不推理）
 * - effort high/max → thinking enabled + reasoning_effort
 * - 显式 thinking 值直接生效；均缺省时什么都不发（跟随供应商默认）
 */
function resolveThinking(input: ChatRequestInput): 'enabled' | 'disabled' | undefined {
  if (input.reasoningEffort === 'off') return 'disabled';
  if (input.reasoningEffort === 'high' || input.reasoningEffort === 'max') return 'enabled';
  return input.thinking === undefined ? undefined : input.thinking ? 'enabled' : 'disabled';
}

/** 默认适配器：OpenAI 兼容协议（POST {baseUrl}/chat/completions，SSE 流式） */
export const openAiCompatibleAdapter: ModelAdapter = {
  id: 'openai-compatible',
  createChatRequest(input: ChatRequestInput): ChatRequest {
    const url = new URL(input.baseUrl);
    url.pathname = url.pathname.replace(/\/+$/, '') + '/chat/completions';
    const thinking = resolveThinking(input);
    return {
      url: url.toString(),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        tools: input.tools,
        stream: true,
        // 流式默认不返回 usage，需显式请求；流末尾会带 usage 帧供用量统计
        stream_options: { include_usage: true },
        // DeepSeek 推理模式与输出上限（对齐官方默认；未配置时省略，供应商默认生效）
        ...(input.maxTokens !== undefined ? { max_tokens: input.maxTokens } : {}),
        ...(thinking !== undefined ? { thinking: { type: thinking } } : {}),
        ...(input.reasoningEffort === 'high' || input.reasoningEffort === 'max'
          ? { reasoning_effort: input.reasoningEffort }
          : {})
      })
    };
  },
  parseDelta(data: string): NormalizedDelta | null | undefined {
    if (data === '[DONE]') return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return undefined;
    }
    return parseOpenAiDelta(parsed);
  }
};
