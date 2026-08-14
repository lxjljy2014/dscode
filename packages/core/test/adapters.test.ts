import { describe, expect, it } from 'vitest';
import { deepseekAdapter } from '../src/adapters/deepseek';
import { parseOpenAiDelta } from '../src/adapters/openai-compatible';

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
