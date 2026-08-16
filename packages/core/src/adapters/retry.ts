/**
 * LLM 请求重试：借鉴官方 harness llm-retry 的指数退避 + jitter 设计。
 * 仅对「瞬时故障」重试：HTTP 429/5xx（ApiError）、网络层错误（fetch 失败）；
 * 用户中止（AbortError）与单轮超时（TimeoutError）不重试——中止是用户意图，超时是部署上限。
 * 退避：initialDelayMs × 2^(attempt-1)，封顶 maxDelayMs，叠加 jitterRatio 随机抖动，避免同批次请求同步重试。
 */

import { ApiError, streamChat } from './stream';
import type { AccumulatedToolCall, ChatRequestInput, ChatUsage, ModelAdapter } from './types';

/** 单轮请求最大重试次数（不含首次尝试） */
const MAX_RETRIES = 2;
/** 首次重试等待（毫秒） */
const RETRY_INITIAL_DELAY_MS = 500;
/** 重试等待封顶（毫秒） */
const RETRY_MAX_DELAY_MS = 8_000;
/** 退避抖动比例 0..1（0.5 = 实际延迟在 50%~150% 之间随机） */
const RETRY_JITTER_RATIO = 0.5;

/** 判断一次失败是否值得重试（瞬时故障语义，与 harness llm-retry 的 retryableCodes 对齐） */
export function isRetryableFailure(error: unknown): boolean {
  if (error instanceof ApiError) {
    // 429 限流 / 5xx 服务端故障：瞬时，重试
    return error.status === 429 || error.status >= 500;
  }
  if (error instanceof Error && error.name === 'AbortError') return false;
  if (error instanceof Error && error.name === 'TimeoutError') return false;
  // 网络层错误（fetch reject：TypeError 'fetch failed'、ECONNRESET 等）：瞬时，重试
  return true;
}

/** 可取消的退避等待：返回 false 表示等待被中止（调用方应抛出中止） */
function cancellableDelay(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, delayMs);
    function onAbort(): void {
      clearTimeout(timer);
      resolve(false);
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** 计算第 attempt 次重试（1-based）的等待时长：指数退避 + jitter，封顶 maxDelayMs */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const exponent = Math.min(attempt - 1, 1024);
  const exponential = Math.min(RETRY_INITIAL_DELAY_MS * 2 ** exponent, RETRY_MAX_DELAY_MS);
  const jitter = 1 - RETRY_JITTER_RATIO + 2 * RETRY_JITTER_RATIO * random();
  return Math.min(exponential * jitter, RETRY_MAX_DELAY_MS);
}

export interface RetryStreamResult {
  toolCalls: AccumulatedToolCall[];
  usage?: ChatUsage;
  /** 实际发生的重试次数（0 = 一次成功；用于统计与排障） */
  retries: number;
}

/**
 * 带重试的流式聊天：首次尝试 + 最多 MAX_RETRIES 次退避重试。
 * 流中已推送的增量（onDelta/onReasoning）在失败后无法回滚——重试只发生在请求层
 * （HTTP 错误/网络错误在首个增量前即失败），流中途异常不重试，直接上抛。
 * @returns 成功响应与重试次数
 */
export async function streamChatWithRetry(
  adapter: ModelAdapter,
  input: ChatRequestInput,
  signal: AbortSignal,
  onDelta: (text: string) => void,
  onReasoning: (text: string) => void
): Promise<RetryStreamResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await streamChat(adapter, input, signal, onDelta, onReasoning);
      return { ...res, retries: attempt };
    } catch (error: unknown) {
      lastError = error;
      if (!isRetryableFailure(error) || attempt >= MAX_RETRIES) throw error;
      if (!await cancellableDelay(retryDelayMs(attempt + 1), signal)) throw error;
    }
  }
  // unreachable：循环内要么 return 要么 throw
  throw lastError;
}
