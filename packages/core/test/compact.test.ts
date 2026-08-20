import { describe, expect, it } from 'vitest';
import type { Message } from '@dscode/shared';
import { applyCompaction, buildCompactionRequest, CHECKPOINT_PREAMBLE, COMPACT_INSTRUCTION, estimateContextProjection, selectCompactableRange } from '../src/agent/compact';

function msg(id: string, role: 'user' | 'assistant', content: string): Message {
  return { id, role, content, createdAt: 1 };
}

function msgs(n: number): Message[] {
  return Array.from({ length: n }, (_, i) => msg(`m${i + 1}`, i % 2 === 0 ? 'user' : 'assistant', `c${i + 1}`));
}

describe('compact 纯逻辑', () => {
  it('历史不足（<= 保留条数）时不压缩', () => {
    expect(selectCompactableRange(msgs(3))).toBeNull();
  });

  it('选择范围：保留最近 3 条，压缩更早的全部', () => {
    expect(selectCompactableRange(msgs(5))).toEqual({ start: 0, end: 1 });
    expect(selectCompactableRange(msgs(4))).toEqual({ start: 0, end: 0 });
  });

  it('构造摘要请求：system 指令 + 被压缩旧 span', () => {
    const all = msgs(5);
    const range = selectCompactableRange(all)!;
    const req = buildCompactionRequest(all, range) as Array<{ role: string; content: string }>;
    expect(req[0]).toEqual({ role: 'system', content: COMPACT_INSTRUCTION });
    expect(req).toHaveLength(3); // system + 2 条被压缩消息
    expect(req[1]).toEqual({ role: 'user', content: 'c1' });
  });

  it('applyCompaction 用检查点替换旧 span，保留最近消息', () => {
    const all = msgs(5);
    const range = selectCompactableRange(all)!;
    const out = applyCompaction(all, range, '结构化摘要', 'm-cp');
    expect(out).toHaveLength(4); // 3 保留 + 1 检查点
    expect(out[0]?.id).toBe('m-cp');
    expect(out[0]?.role).toBe('user');
    expect(out[0]?.content).toContain(CHECKPOINT_PREAMBLE);
    expect(out[0]?.content).toContain('结构化摘要');
    expect(out[3]?.id).toBe('m5'); // 最近消息保留
  });

  it('estimateContextProjection：构成分项之和 = 总占用，且随消息减少而回落', () => {
    const before = estimateContextProjection('系统提示词', [{ name: 't' }], msgs(5));
    expect(before.contextTokens).toBe(before.systemTokens + before.toolsTokens + before.messagesTokens);
    expect(before.systemTokens).toBeGreaterThan(0);
    expect(before.toolsTokens).toBeGreaterThan(0);
    expect(before.messagesTokens).toBeGreaterThan(0);

    const after = estimateContextProjection('系统提示词', [{ name: 't' }], msgs(2));
    expect(after.systemTokens).toBe(before.systemTokens); // 系统提示词不变
    expect(after.toolsTokens).toBe(before.toolsTokens); // 工具不变
    expect(after.messagesTokens).toBeLessThan(before.messagesTokens); // 消息变少占用回落
  });
});
