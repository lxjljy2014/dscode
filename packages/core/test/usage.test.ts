import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeUsageDbs, initUsage, listUsage, recordUsage } from '../src/persist/usage';

let dir: string;
let file: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dscode-usage-'));
  file = join(dir, 'usage.db');
});

afterAll(async () => {
  // 先关闭 sqlite 连接再删目录：Windows 下未关闭的文件句柄会使 rm 失败（文件级测试失败的真凶）
  closeUsageDbs();
  await rm(dir, { recursive: true, force: true });
});

describe('usage 持久化', () => {
  it('空库列表为空', () => {
    initUsage(file);
    expect(listUsage(file)).toEqual([]);
  });

  it('记录并按时间倒序读回', () => {
    recordUsage(file, { sessionId: 's1', model: 'm1', promptTokens: 100, completionTokens: 50, createdAt: 1000 });
    recordUsage(file, { sessionId: 's2', model: 'm2', promptTokens: 200, completionTokens: 80, createdAt: 2000 });
    const list = listUsage(file);
    expect(list).toHaveLength(2);
    expect(list[0]?.model).toBe('m2');
    expect(list[0]?.promptTokens).toBe(200);
    expect(list[1]?.completionTokens).toBe(50);
  });

  it('API 前缀缓存命中 tokens 落库并读回（缺省 0）', () => {
    recordUsage(file, { sessionId: 's3', model: 'm3', promptTokens: 1000, completionTokens: 100, createdAt: 3000, cachedPromptTokens: 800 });
    recordUsage(file, { sessionId: 's4', model: 'm4', promptTokens: 500, completionTokens: 50, createdAt: 4000 });
    const list = listUsage(file);
    const s3 = list.find(r => r.sessionId === 's3');
    expect(s3?.cachedPromptTokens).toBe(800);
    const s4 = list.find(r => r.sessionId === 's4');
    expect(s4?.cachedPromptTokens).toBe(0); // 缺省列值 0
  });


  it('cacheTracked：新记录为 true，旧库迁移记录为 false', async () => {
    recordUsage(file, { sessionId: 's-t', model: 'm', promptTokens: 10, completionTokens: 1, createdAt: 5000, cachedPromptTokens: 5 });
    const list = listUsage(file);
    expect(list.find(r => r.sessionId === 's-t')?.cacheTracked).toBe(true);
  });
  it('旧库无 cached_prompt_tokens 列时自动迁移，读回不报错', async () => {
    const oldFile = join(dir, 'usage-old.db');
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(oldFile);
    db.exec(
      'CREATE TABLE usage_records (' +
        'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
        'session_id TEXT NOT NULL, ' +
        'model TEXT NOT NULL, ' +
        'prompt_tokens INTEGER NOT NULL, ' +
        'completion_tokens INTEGER NOT NULL, ' +
        'created_at INTEGER NOT NULL)'
    );
    db.prepare('INSERT INTO usage_records (session_id, model, prompt_tokens, completion_tokens, created_at) VALUES (?, ?, ?, ?, ?)').run('s-old', 'm', 10, 5, 1);
    db.close();
    try {
      const list = listUsage(oldFile);
      expect(list).toHaveLength(1);
      expect(list[0]?.cachedPromptTokens).toBe(0);
    } finally {
      closeUsageDbs();
      await rm(oldFile, { force: true });
    }
  });
});