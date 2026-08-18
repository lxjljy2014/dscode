import { describe, expect, it } from 'vitest';
import { isChatMessagePayload, isMessage, isSession, isSessionStats, isSettingsPatch, isString, parseTerminalSize } from '../src/main/validators';

describe('isString', () => {
  it('字符串为真，其余为假', () => {
    expect(isString('x')).toBe(true);
    expect(isString('')).toBe(true);
    expect(isString(1)).toBe(false);
    expect(isString(null)).toBe(false);
    expect(isString(undefined)).toBe(false);
    expect(isString({})).toBe(false);
  });
});

describe('isChatMessagePayload', () => {
  it('user/assistant 且 content 为字符串', () => {
    expect(isChatMessagePayload({ role: 'user', content: 'hi' })).toBe(true);
    expect(isChatMessagePayload({ role: 'assistant', content: '' })).toBe(true);
  });

  it('拒绝 system 角色与畸形字段', () => {
    expect(isChatMessagePayload({ role: 'system', content: 'x' })).toBe(false);
    expect(isChatMessagePayload({ role: 'user' })).toBe(false);
    expect(isChatMessagePayload({ role: 'user', content: 1 })).toBe(false);
    expect(isChatMessagePayload(null)).toBe(false);
    expect(isChatMessagePayload('x')).toBe(false);
  });

  it('接受 assistant 带 tool_calls 的重建结构（前缀缓存对齐）', () => {
    expect(
      isChatMessagePayload({
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }]
      })
    ).toBe(true);
  });

  it('接受 tool 结果消息（role:tool + tool_call_id + content）与 reasoning_content 回传', () => {
    expect(
      isChatMessagePayload({
        role: 'tool',
        content: '文件内容...',
        tool_call_id: 'call_1'
      })
    ).toBe(true);
    expect(
      isChatMessagePayload({
        role: 'assistant',
        content: '',
        reasoning_content: '先搜索文件再修改',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }]
      })
    ).toBe(true);
  });

  it('拒绝 tool 消息畸形字段（缺 content / 坏 tool_call_id / 坏 reasoning_content）', () => {
    expect(isChatMessagePayload({ role: 'tool', tool_call_id: 'c1' })).toBe(false);
    expect(isChatMessagePayload({ role: 'tool', content: 'x', tool_call_id: 1 })).toBe(false);
    expect(isChatMessagePayload({ role: 'assistant', content: '', reasoning_content: 1 })).toBe(false);
    expect(isChatMessagePayload({ role: 'tool', content: 'x' })).toBe(true); // tool_call_id 可选不强制
  });

  it('拒绝畸形 tool_calls', () => {
    expect(
      isChatMessagePayload({
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 1, type: 'function', function: { name: 'x', arguments: '{}' } }]
      })
    ).toBe(false);
    expect(isChatMessagePayload({ role: 'assistant', content: '', tool_calls: 'nope' })).toBe(false);
    expect(
      isChatMessagePayload({
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'a', type: 'wrong', function: { name: 'x', arguments: '{}' } }]
      })
    ).toBe(false);
  });
});

describe('isMessage', () => {
  it('必需字段齐全且类型正确', () => {
    expect(isMessage({ id: 'm1', role: 'user', content: 'x', createdAt: 1 })).toBe(true);
    expect(isMessage({ id: 'm1', role: 'assistant', content: 'x', createdAt: 1, errorCode: 'api' })).toBe(true);
  });

  it('合法 steps（reasoning/text/tool 交错）通过', () => {
    const steps = [
      { kind: 'reasoning', content: '先想一下' },
      {
        kind: 'tool',
        event: {
          id: 'e1',
          name: 'write_file',
          args: '{}',
          status: 'done',
          createdAt: 1,
          summary: 'ok',
          content: '全量结果'
        }
      },
      { kind: 'text', content: '完成了' }
    ];
    expect(isMessage({ id: 'm1', role: 'assistant', content: 'x', createdAt: 1, steps })).toBe(true);
    expect(isMessage({ id: 'm1', role: 'user', content: 'x', createdAt: 1, steps: [] })).toBe(true);
  });

  it('拒绝非法 steps（未知工具/坏状态/缺字段）', () => {
    const base = { id: 'm1', role: 'assistant' as const, content: 'x', createdAt: 1 };
    expect(
      isMessage({
        ...base,
        steps: [{ kind: 'tool', event: { id: 'e', name: 'evil', args: '{}', status: 'done', createdAt: 1 } }]
      })
    ).toBe(false);
    expect(
      isMessage({
        ...base,
        steps: [{ kind: 'tool', event: { id: 'e', name: 'write_file', args: '{}', status: 'hacked', createdAt: 1 } }]
      })
    ).toBe(false);
    expect(
      isMessage({
        ...base,
        steps: [{ kind: 'tool', event: { id: 'e', name: 'write_file', args: 1, status: 'done', createdAt: 1 } }]
      })
    ).toBe(false);
    expect(isMessage({ ...base, steps: [{ kind: 'text', content: 1 }] })).toBe(false);
    expect(isMessage({ ...base, steps: [{ kind: 'other', content: 'x' }] })).toBe(false);
    expect(isMessage({ ...base, steps: 'not-array' })).toBe(false);
  });

  it('拒绝非法字段', () => {
    expect(isMessage({ id: 'm1', role: 'user', content: 'x' })).toBe(false);
    expect(isMessage({ id: 'm1', role: 'system', content: 'x', createdAt: 1 })).toBe(false);
    expect(isMessage({ id: 'm1', role: 'user', content: 'x', createdAt: 1, errorCode: 2 })).toBe(false);
    expect(isMessage({ id: 'm1', role: 'user', content: 1, createdAt: 1 })).toBe(false);
    expect(isMessage(null)).toBe(false);
  });
});

describe('isSession', () => {
  it('必需字段齐全', () => {
    expect(isSession({ id: 's1', title: 't', workingDirectory: '/w', createdAt: 1, updatedAt: 2 })).toBe(true);
  });

  it('拒绝畸形字段', () => {
    expect(isSession({ id: 's1', title: 't', workingDirectory: '/w', createdAt: 1 })).toBe(false);
    expect(isSession({ id: 's1', title: 't', workingDirectory: '/w', createdAt: '1', updatedAt: 2 })).toBe(false);
    expect(isSession({ id: 1, title: 't', workingDirectory: '/w', createdAt: 1, updatedAt: 2 })).toBe(false);
    expect(isSession(null)).toBe(false);
  });
});

describe('parseTerminalSize', () => {
  it('合法整数返回 [cols, rows]', () => {
    expect(parseTerminalSize(80, 24)).toEqual([80, 24]);
    expect(parseTerminalSize(2, 1)).toEqual([2, 1]);
    expect(parseTerminalSize(500, 200)).toEqual([500, 200]);
  });

  it('越界或非整数返回 null', () => {
    expect(parseTerminalSize(1, 24)).toBeNull();
    expect(parseTerminalSize(501, 24)).toBeNull();
    expect(parseTerminalSize(80, 0)).toBeNull();
    expect(parseTerminalSize(80, 201)).toBeNull();
    expect(parseTerminalSize(80.5, 24)).toBeNull();
    expect(parseTerminalSize('80', 24)).toBeNull();
    expect(parseTerminalSize(80, '24')).toBeNull();
  });
});

describe('isSettingsPatch', () => {
  it('白名单字段通过', () => {
    expect(isSettingsPatch({ workingDirectory: '/x' })).toBe(true);
    expect(isSettingsPatch({ permissionMode: 'plan', browsingEnabled: false })).toBe(true);
    expect(isSettingsPatch({})).toBe(true);
  });

  it('未知 key / 非对象拒绝', () => {
    expect(isSettingsPatch({ evil: 1 })).toBe(false);
    expect(isSettingsPatch({ workingDirectory: '/x', evil: 1 })).toBe(false);
    expect(isSettingsPatch(null)).toBe(false);
    expect(isSettingsPatch('x')).toBe(false);
    expect(isSettingsPatch([])).toBe(false);
  });
});

describe('isSessionStats', () => {
  const full = {
    rounds: 1, llmMs: 100, toolMs: 50,
    firstTokenMsSum: 30, firstTokenCount: 1,
    promptTokens: 500, completionTokens: 200,
    cacheHits: 1, cacheMisses: 2, cacheHitTokens: 400, cacheMissTokens: 100,
    contextTokens: 600, systemTokens: 50, toolsTokens: 150, messagesTokens: 400
  };

  it('全字段合法通过', () => {
    expect(isSessionStats(full)).toBe(true);
  });

  it('缺必填字段拒绝', () => {
    const { cacheHits: _omit, ...rest } = full;
    expect(isSessionStats(rest)).toBe(false);
    expect(isSessionStats({ rounds: 1, llmMs: 100, toolMs: 50 })).toBe(false);
  });

  it('NaN/Infinity 拒绝', () => {
    expect(isSessionStats({ ...full, rounds: NaN })).toBe(false);
    expect(isSessionStats({ ...full, promptTokens: Infinity })).toBe(false);
  });
});

describe('isMessage 工具事件步骤', () => {
  it('接受 run_code / skill 工具事件（历史重建不被拒绝）', () => {
    const base = { id: 'm1', role: 'assistant', content: '', createdAt: 1 };
    const mk = (name: string) => ({
      ...base,
      steps: [{ kind: 'tool', event: {
        id: 't1', name, args: '{}', status: 'done', createdAt: 1, content: 'x'
      } }]
    });
    expect(isMessage(mk('run_code'))).toBe(true);
    expect(isMessage(mk('skill'))).toBe(true);
  });
});