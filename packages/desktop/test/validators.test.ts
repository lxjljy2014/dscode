import { describe, expect, it } from 'vitest';
import { isChatMessagePayload, isMessage, isSession, isString, parseTerminalSize } from '../src/main/validators';

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
});

describe('isMessage', () => {
  it('必需字段齐全且类型正确', () => {
    expect(isMessage({ id: 'm1', role: 'user', content: 'x', createdAt: 1 })).toBe(true);
    expect(isMessage({ id: 'm1', role: 'assistant', content: 'x', createdAt: 1, errorCode: 'api' })).toBe(true);
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
