import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildIndex, indexStats, initIndex, searchIndex } from '../src/workspace/index';

let dir: string;
let cwd: string;
let dbFile: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dscode-index-'));
  cwd = join(dir, 'ws');
  await mkdir(cwd);
  dbFile = join(dir, 'index.db');
  await writeFile(join(cwd, 'a.ts'), 'function helloWorld() { return 42; }');
  await writeFile(join(cwd, 'b.ts'), 'const greeting = "hello";');
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('代码索引', () => {
  it('buildIndex 建立倒排并统计', async () => {
    const stats = await buildIndex(cwd, dbFile);
    expect(stats.fileCount).toBe(2);
    expect(stats.termCount).toBeGreaterThan(0);
    expect(stats.builtAt).toBeGreaterThan(0);
  });

  it('searchIndex 支持 camelCase 切分与多词 AND', () => {
    // helloWorld → hello + world；hello 出现在两个文件，但 world 只在 a.ts
    const hits = searchIndex(dbFile, 'hello world');
    expect(hits.map(h => h.path)).toContain('a.ts');
    expect(hits.map(h => h.path)).not.toContain('b.ts');
  });

  it('空库 stats 为零', () => {
    const empty = join(dir, 'empty.db');
    initIndex(empty);
    expect(indexStats(empty).fileCount).toBe(0);
    expect(indexStats(empty).builtAt).toBe(0);
  });
});
