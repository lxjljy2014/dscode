import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/adapters/stream';
import { isRetryableFailure, retryDelayMs } from '../src/adapters/retry';

describe('isRetryableFailure（借鉴官方 harness retryableCodes）', () => {
  it('429 限流可重试', () => {
    expect(isRetryableFailure(new ApiError(429, 'rate limited'))).toBe(true);
  });

  it('5xx 服务端故障可重试', () => {
    expect(isRetryableFailure(new ApiError(500, 'boom'))).toBe(true);
    expect(isRetryableFailure(new ApiError(502, 'bad gateway'))).toBe(true);
    expect(isRetryableFailure(new ApiError(503, 'unavailable'))).toBe(true);
  });

  it('4xx 客户端错误不可重试', () => {
    expect(isRetryableFailure(new ApiError(400, 'bad request'))).toBe(false);
    expect(isRetryableFailure(new ApiError(401, 'unauthorized'))).toBe(false);
    expect(isRetryableFailure(new ApiError(404, 'not found'))).toBe(false);
  });

  it('网络层错误可重试', () => {
    expect(isRetryableFailure(new TypeError('fetch failed'))).toBe(true);
  });

  it('中止与超时不重试（用户意图/部署上限）', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(isRetryableFailure(abort)).toBe(false);
    const timeout = new Error('timeout');
    timeout.name = 'TimeoutError';
    expect(isRetryableFailure(timeout)).toBe(false);
  });
});

describe('retryDelayMs（指数退避 + jitter）', () => {
  it('退避递增且封顶', () => {
    // random 固定 0.5 → jitter = 1.0，退避 = exponential
    expect(retryDelayMs(1, () => 0.5)).toBe(500);
    expect(retryDelayMs(2, () => 0.5)).toBe(1000);
    expect(retryDelayMs(3, () => 0.5)).toBe(2000);
    expect(retryDelayMs(4, () => 0.5)).toBe(4000);
    expect(retryDelayMs(10, () => 0.5)).toBe(8000); // 封顶
  });

  it('jitter 抖动范围在 [0.5x, 1.5x] 内', () => {
    for (let i = 0; i < 20; i++) {
      const d = retryDelayMs(3);
      expect(d).toBeGreaterThanOrEqual(1000);
      expect(d).toBeLessThanOrEqual(3000);
    }
  });
});
