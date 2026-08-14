import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initUsage, listUsage, recordUsage } from '../src/persist/usage';

let dir: string;
let file: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dscode-usage-'));
  file = join(dir, 'usage.db');
});

afterAll(async () => {
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
});
