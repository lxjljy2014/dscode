import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamChat } from '../src/adapters/stream';
import { streamChatWithRetry } from '../src/adapters/retry';
import { openAiCompatibleAdapter } from '../src/adapters/openai-compatible';
import type { ChatRequestInput } from '../src/adapters/types';

afterEach(() => vi.unstubAllGlobals());

const input: ChatRequestInput = { baseUrl: 'https://x', apiKey: 'k', model: 'm', messages: [], tools: [] };

/** 构造按序吐块的 body 读取器 */
function bodyFromChunks(chunks: string[]): { getReader: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }> } } {
  const enc = new TextEncoder();
  const encoded = chunks.map(c => enc.encode(c));
  let i = 0;
  return { getReader: () => ({ read: async () => (i < encoded.length ? { done: false, value: encoded[i++] } : { done: true, value: undefined }) }) };
}

describe('streamChat 尾帧', () => {
  it('无结尾换行的 usage 尾帧也被解析（不再静默丢失）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: bodyFromChunks([
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
        'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2}}'
      ])
    }));
    const onDelta = vi.fn();
    const res = await streamChat(openAiCompatibleAdapter, input, new AbortController().signal, onDelta, vi.fn());
    expect(onDelta).toHaveBeenCalledWith('hi');
    expect(res.usage?.promptTokens).toBe(10);
    expect(res.usage?.completionTokens).toBe(2);
  });
});

describe('streamChatWithRetry 流中断', () => {
  it('已推增量后失败不重试（防重复输出）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => {
          let calls = 0;
          const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n');
          return {
            read: async () => {
              calls++;
              if (calls === 1) return { done: false, value: bytes };
              throw new TypeError('fetch failed');
            }
          };
        }
      }
    });
    vi.stubGlobal('fetch', fetchMock);
    const onDelta = vi.fn();
    await expect(
      streamChatWithRetry(openAiCompatibleAdapter, input, new AbortController().signal, onDelta, vi.fn())
    ).rejects.toThrow('fetch failed');
    expect(fetchMock).toHaveBeenCalledTimes(1); // 未重试
    expect(onDelta).toHaveBeenCalledWith('hi');
  });
});
