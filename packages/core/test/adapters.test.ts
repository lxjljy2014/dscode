import { describe, expect, it } from 'vitest';
import { deepseekAdapter } from '../src/adapters/deepseek';
import { openAiCompatibleAdapter, parseOpenAiDelta } from '../src/adapters/openai-compatible';

describe('parseOpenAiDelta', () => {
  it('解析正文增量', () => {
    const d = parseOpenAiDelta({ choices: [{ delta: { content: 'hi' } }] });
    expect(d?.content).toBe('hi');
  });

  it('解析工具调用增量（按 index 累积）', () => {
    const d = parseOpenAiDelta({
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'read_file', arguments: '{"pa' } }] } }]
    });
    expect(d?.toolCalls?.[0]).toMatchObject({ index: 0, id: 'a', name: 'read_file' });
    expect(d?.toolCalls?.[0].arguments).toBe('{"pa');
  });

  it('无 choices 返回 undefined', () => {
    expect(parseOpenAiDelta({})).toBeUndefined();
  });

  it('解析流末尾 usage 帧', () => {
    const d = parseOpenAiDelta({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 50 } });
    expect(d?.usage).toEqual({ promptTokens: 100, completionTokens: 50 });
  });

  it('解析前缀缓存命中 tokens（prompt_tokens_details.cached_tokens）', () => {
    const d = parseOpenAiDelta({
      choices: [],
      usage: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 80 } }
    });
    expect(d?.usage).toEqual({ promptTokens: 100, completionTokens: 50, cachedPromptTokens: 80 });
  });

  it('解析 DeepSeek 旧字段 prompt_cache_hit_tokens', () => {
    const d = parseOpenAiDelta({
      choices: [],
      usage: { prompt_tokens: 100, completion_tokens: 50, prompt_cache_hit_tokens: 90 }
    });
    expect(d?.usage?.cachedPromptTokens).toBe(90);
  });

  it('无缓存字段时 cachedPromptTokens 缺省', () => {
    const d = parseOpenAiDelta({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 50 } });
    expect(d?.usage?.cachedPromptTokens).toBeUndefined();
  });
});

describe('createChatRequest（DeepSeek thinking/effort/max_tokens 对齐）', () => {
  const base = {
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'sk',
    model: 'deepseek-v4-pro',
    messages: [],
    tools: []
  };

  it('未配置时省略 thinking/reasoning_effort/max_tokens（供应商默认生效）', () => {
    const body = JSON.parse(openAiCompatibleAdapter.createChatRequest(base).body) as Record<string, unknown>;
    expect(body['thinking']).toBeUndefined();
    expect(body['reasoning_effort']).toBeUndefined();
    expect(body['max_tokens']).toBeUndefined();
  });

  it('thinking true → thinking {type: enabled}', () => {
    const body = JSON.parse(openAiCompatibleAdapter.createChatRequest({ ...base, thinking: true }).body) as Record<
      string,
      unknown
    >;
    expect(body['thinking']).toEqual({ type: 'enabled' });
  });

  it('thinking false → thinking {type: disabled}', () => {
    const body = JSON.parse(openAiCompatibleAdapter.createChatRequest({ ...base, thinking: false }).body) as Record<
      string,
      unknown
    >;
    expect(body['thinking']).toEqual({ type: 'disabled' });
  });

  it('effort high/max → thinking enabled + reasoning_effort', () => {
    for (const effort of ['high' as const, 'max' as const]) {
      const body = JSON.parse(
        openAiCompatibleAdapter.createChatRequest({ ...base, reasoningEffort: effort }).body
      ) as Record<string, unknown>;
      expect(body['thinking']).toEqual({ type: 'enabled' });
      expect(body['reasoning_effort']).toBe(effort);
    }
  });

  it('effort off → thinking disabled 且不携带 reasoning_effort', () => {
    const body = JSON.parse(
      openAiCompatibleAdapter.createChatRequest({ ...base, reasoningEffort: 'off' }).body
    ) as Record<string, unknown>;
    expect(body['thinking']).toEqual({ type: 'disabled' });
    expect(body['reasoning_effort']).toBeUndefined();
  });

  it('maxTokens → max_tokens', () => {
    const body = JSON.parse(openAiCompatibleAdapter.createChatRequest({ ...base, maxTokens: 256000 }).body) as Record<
      string,
      unknown
    >;
    expect(body['max_tokens']).toBe(256000);
  });

  it('stream_options 始终携带 include_usage（前缀缓存统计依赖）', () => {
    const body = JSON.parse(openAiCompatibleAdapter.createChatRequest(base).body) as Record<string, unknown>;
    expect(body['stream_options']).toEqual({ include_usage: true });
  });
});

describe('deepseekAdapter', () => {
  it('[DONE] 返回 null', () => {
    expect(deepseekAdapter.parseDelta('[DONE]')).toBeNull();
  });

  it('解析 reasoning_content 思维链', () => {
    const d = deepseekAdapter.parseDelta(JSON.stringify({ choices: [{ delta: { reasoning_content: '思考中' } }] }));
    expect(d?.reasoning).toBe('思考中');
  });

  it('同时解析正文与思维链', () => {
    const d = deepseekAdapter.parseDelta(
      JSON.stringify({ choices: [{ delta: { content: '答', reasoning_content: '思' } }] })
    );
    expect(d?.content).toBe('答');
    expect(d?.reasoning).toBe('思');
  });
});
