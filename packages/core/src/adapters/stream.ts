import type { AgentToolName } from '@dscode/shared';
import type { AccumulatedToolCall, ChatRequestInput, ChatUsage, ModelAdapter, NormalizedDelta } from './types';

/** HTTP 非 2xx 错误（携带状态码与响应体片段，供上层映射 agent:error） */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * 通用 SSE 流式聊天：请求构造交给适配器，逐行 data 解析交给适配器，
 * 文本/思维链增量经回调上抛，tool_calls 按 index 累积后返回。
 * parseDelta 返回 null（[DONE]）时立即结束，不再依赖连接关闭。
 */
export async function streamChat(
  adapter: ModelAdapter,
  input: ChatRequestInput,
  signal: AbortSignal,
  onDelta: (text: string) => void,
  onReasoning: (text: string) => void
): Promise<{ toolCalls: AccumulatedToolCall[]; usage?: ChatUsage }> {
  const { url, headers, body } = adapter.createChatRequest(input);
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, text.slice(0, 500));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const toolCalls = new Map<number, AccumulatedToolCall>();
  let usage: ChatUsage | undefined;
  let ended = false;

  /** 应用一个归一化增量（文本/思维链/工具调用/usage），供循环与尾帧共用 */
  const applyDelta = (delta: NormalizedDelta | null | undefined): void => {
    if (delta === null) {
      ended = true;
      return;
    }
    if (!delta) return;
    if (delta.content) onDelta(delta.content);
    if (delta.reasoning) onReasoning(delta.reasoning);
    if (delta.usage) usage = delta.usage;
    for (const raw of delta.toolCalls ?? []) {
      const index = raw.index >= 0 ? raw.index : toolCalls.size;
      let acc = toolCalls.get(index);
      if (!acc) {
        acc = { index, id: '', name: '' as AgentToolName, arguments: '' };
        toolCalls.set(index, acc);
      }
      if (typeof raw.id === 'string') acc.id = raw.id;
      if (typeof raw.name === 'string') acc.name = raw.name as AgentToolName;
      if (typeof raw.arguments === 'string') acc.arguments += raw.arguments;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done || ended) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      applyDelta(adapter.parseDelta(line.slice(5).trim()));
      if (ended) break;
    }
  }
  // 尾帧兜底：flush decoder 残余字节，并处理无结尾换行的最后一行（如流末尾的 usage 帧/多字节 UTF-8 截断）
  buffer += decoder.decode();
  const tail = buffer.trim();
  if (!ended && tail.startsWith('data:')) {
    applyDelta(adapter.parseDelta(tail.slice(5).trim()));
  }
  return { toolCalls: [...toolCalls.values()].sort((a, b) => a.index - b.index), usage };
}
