import { describe, expect, it } from 'vitest';
import { estimateMessageTokens, estimateSystemTokens, estimateTokens, estimateToolsTokens } from '../src/agent/token-estimate';

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

describe('结构化估算（role/块开销）', () => {
  it('estimateSystemTokens 加 role 框架开销', () => {
    expect(estimateSystemTokens('abcd')).toBe(estimateTokens('abcd') + 4);
  });

  it('estimateToolsTokens 加块结构开销', () => {
    expect(estimateToolsTokens([])).toBe(estimateTokens('[]') + 4);
  });

  it('estimateMessageTokens：正文 + role 开销；工具调用回合加 tool_calls', () => {
    const plain = estimateMessageTokens({ role: 'user', content: 'abcd' });
    expect(plain).toBe(estimateTokens('abcd') + 4);

    const withTools = estimateMessageTokens({
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{}' } }]
    });
    // 空正文 + role 开销 + 1 个工具调用的 JSON 密度 + 块开销
    expect(withTools).toBeGreaterThan(4);
  });
});
