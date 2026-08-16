import { describe, expect, it } from 'vitest';
import { estimateTokens } from '../src/agent/token-estimate';

describe('estimateTokens 上下文构成估算', () => {
  it('空字符串为 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('纯 ASCII（英文/代码）约 4 字符 1 token', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('hello world')).toBe(3);
  });

  it('非 ASCII（中文）按字符计 token', () => {
    expect(estimateTokens('中文')).toBe(2);
    expect(estimateTokens('你好世界')).toBe(4);
  });

  it('混合中英文正确叠加', () => {
    expect(estimateTokens('a中文')).toBe(3);
  });
});
