import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Session } from '@dscode/shared';
import { initSessions, listSessions, upsertMessage, upsertSession } from '../src/persist/sessions';

/**
 * 会话缓存淘汰回归：dirCache / knownMessageIds 有条目上限（按插入序淘汰），
 * 淘汰后的旧会话再次写入时必须走 findSessionDir 重扫 + loadKnownIds 重读，
 * 结果仍正确（消息不丢、不重复）。内部 Map 不可见，以行为等价验证。
 */

describe('会话缓存淘汰', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'dscode-cache-evict-'));
    initSessions(rootDir);
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  function makeSession(i: number): Session {
    return {
      id: `s${i}`,
      title: `会话 ${i}`,
      workingDirectory: '/ws',
      createdAt: i,
      updatedAt: i,
      messages: [],
      toolEvents: []
    };
  }

  it('缓存淘汰后旧会话仍可正确追加与读回', () => {
    // 超过 MAX_CACHE_ENTRIES（256）的会话量：早期会话的缓存条目必然被淘汰
    const total = 300;
    for (let i = 0; i < total; i++) upsertSession(rootDir, makeSession(i));

    // 对最早的会话（缓存必已淘汰）追加消息：走目录重扫 + id 集合重读路径
    upsertMessage(rootDir, 's0', { id: 'm1', role: 'user', content: '第一条', createdAt: 1 });
    upsertMessage(rootDir, 's0', { id: 'm2', role: 'assistant', content: '第二条', createdAt: 2 });
    // 幂等重写（id 已在「重读后的」缓存里）：更新而非重复追加
    upsertMessage(rootDir, 's0', { id: 'm2', role: 'assistant', content: '第二条(改)', createdAt: 2 });
    // 最新会话（缓存命中路径）同样正确
    upsertMessage(rootDir, `s${total - 1}`, { id: 'm1', role: 'user', content: '新会话消息', createdAt: 3 });

    const sessions = new Map(listSessions(rootDir).map(s => [s.id, s]));
    expect(sessions.size).toBe(total);
    const oldest = sessions.get('s0');
    expect(oldest?.messages.map(m => m.content)).toEqual(['第一条', '第二条(改)']);
    const newest = sessions.get(`s${total - 1}`);
    expect(newest?.messages.map(m => m.content)).toEqual(['新会话消息']);
  });

  it('单会话大量消息的追加与幂等重写仍正确', () => {
    // 单文件对应一个 id Set（Set 本身无上限）；压追加判重与幂等重写路径
    upsertSession(rootDir, makeSession(0));
    const count = 260;
    for (let i = 0; i < count; i++) {
      upsertMessage(rootDir, 's0', { id: `m${i}`, role: 'user', content: `c${i}`, createdAt: i });
    }
    // 重写早期消息（幂等更新路径）
    upsertMessage(rootDir, 's0', { id: 'm0', role: 'user', content: 'c0-改', createdAt: 0 });

    const [session] = listSessions(rootDir);
    expect(session.messages).toHaveLength(count);
    expect(session.messages[0]?.content).toBe('c0-改');
    expect(session.messages[1]?.content).toBe('c1');
  });
});
