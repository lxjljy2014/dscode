import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCacheKey, createSqliteLlmCache, initLlmCache } from '../src/cache/llm-cache';

/**
 * LLM 回复缓存单测：key 确定性、sqlite 落库往返、命中/未命中统计、容量控制。
 */

describe('buildCacheKey', () => {
  it('相同输入产出相同 key（确定性）', () => {
    const messages = [{ role: 'user', content: '你好' }];
    const tools = [{ type: 'function', function: { name: 'read_file' } }];
    expect(buildCacheKey('m1', messages, tools)).toBe(buildCacheKey('m1', messages, tools));
  });

  it('模型/消息/工具任一变化都得到不同 key', () => {
    const messages = [{ role: 'user', content: '你好' }];
    const tools = [{ type: 'function', function: { name: 'read_file' } }];
    const base = buildCacheKey('m1', messages, tools);
    expect(buildCacheKey('m2', messages, tools)).not.toBe(base);
    expect(buildCacheKey('m1', [{ role: 'user', content: '再见' }], tools)).not.toBe(base);
    expect(buildCacheKey('m1', messages, [])).not.toBe(base);
  });

  it('消息顺序敏感（多轮上下文累积）', () => {
    const a = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' }
    ];
    const b = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'c' }
    ];
    expect(buildCacheKey('m', a, [])).not.toBe(buildCacheKey('m', b, []));
  });
});

describe('createSqliteLlmCache', () => {
  let dir: string;
  let file: string;
  afterEach(async () => {
    // 尽力清理临时目录（Windows 下偶发 EBUSY 为预存 flake，不影响断言结果）
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  async function fresh(): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), 'dscode-cache-'));
    file = join(dir, 'cache.db');
    initLlmCache(file);
    return file;
  }

  it('set 后可 get 完整往返（含工具调用 JSON）', async () => {
    await fresh();
    const cache = createSqliteLlmCache(file);
    const key = cache.key('m', [{ role: 'user', content: 'hi' }], []);
    await cache.set(key, {
      content: '正文',
      reasoning: '思考',
      toolCalls: [{ id: 't1', name: 'read_file', arguments: '{"path":"a.ts"}' }],
      promptTokens: 10,
      completionTokens: 5
    });
    const got = await cache.get(key);
    expect(got).not.toBeNull();
    expect(got?.content).toBe('正文');
    expect(got?.reasoning).toBe('思考');
    expect(got?.toolCalls).toEqual([{ id: 't1', name: 'read_file', arguments: '{"path":"a.ts"}' }]);
    expect(got?.promptTokens).toBe(10);
  });

  it('未命中返回 null', async () => {
    await fresh();
    const cache = createSqliteLlmCache(file);
    expect(await cache.get('llm:none')).toBeNull();
  });

  it('命中/未命中统计：hitRate 与节省 token 正确', async () => {
    await fresh();
    const cache = createSqliteLlmCache(file);
    await cache.recordMiss('m1');
    await cache.recordMiss('m1');
    await cache.recordHit('m1', 100, 20);
    await cache.recordHit('m1', 50, 10);
    const s = await cache.stats();
    expect(s.hits).toBe(2);
    expect(s.misses).toBe(2);
    expect(s.hitRate).toBeCloseTo(0.5);
    expect(s.savedPromptTokens).toBe(150);
    expect(s.savedCompletionTokens).toBe(30);
  });

  it('按模型分别累计，汇总正确', async () => {
    await fresh();
    const cache = createSqliteLlmCache(file);
    await cache.recordHit('m1', 1, 0);
    await cache.recordMiss('m2');
    const s = await cache.stats();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(1);
  });

  it('clear 清空条目与统计，stats 归零', async () => {
    await fresh();
    const cache = createSqliteLlmCache(file);
    await cache.set(cache.key('m', [{ role: 'user', content: 'x' }], []), {
      content: 'c',
      reasoning: '',
      toolCalls: [],
      promptTokens: 1,
      completionTokens: 1
    });
    await cache.recordMiss('m');
    const s = await cache.clear();
    expect(s.hits).toBe(0);
    expect(s.misses).toBe(0);
    expect(s.entries).toBe(0);
    expect(await cache.get('any')).toBeNull();
  });

  it('容量控制：超出上限时清理最旧条目', async () => {
    await fresh();
    const cache = createSqliteLlmCache(file, 5);
    for (let i = 0; i < 6; i++) {
      await cache.set('k' + i, {
        content: 'c' + i,
        reasoning: '',
        toolCalls: [],
        promptTokens: i,
        completionTokens: 0
      });
    }
    const s = await cache.stats();
    expect(s.entries).toBe(5); // 6 条写入，超限后保留 5
    expect(await cache.get('k0')).toBeNull(); // 最旧的被清理
    expect(await cache.get('k5')).not.toBeNull(); // 最新的保留
  });

  it('tool_calls JSON 损坏时按未命中处理（不抛异常）', async () => {
    await fresh();
    const db = new (require('node:sqlite').DatabaseSync)(file);
    db.prepare(
      'INSERT INTO llm_cache_entries (key, model, content, reasoning, tool_calls, prompt_tokens, completion_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('bad', '', 'c', '', 'not-json', 0, 0, 1);
    db.close();
    const cache = createSqliteLlmCache(file);
    expect(await cache.get('bad')).toBeNull();
  });
});
