import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDiffFile, diffLines, DiffSnapshotStore, MAX_SESSION_SNAPSHOTS } from '../src/workspace/diff';

describe('diffLines', () => {
  it('相同内容无 diff', () => {
    expect(diffLines('a\nb\nc', 'a\nb\nc')).toEqual([]);
  });

  it('单行替换产生 del + add', () => {
    const lines = diffLines('a\nb\nc', 'a\nx\nc');
    expect(lines.some(l => l.type === 'del' && l.content === 'b')).toBe(true);
    expect(lines.some(l => l.type === 'add' && l.content === 'x')).toBe(true);
  });

  it('删除行', () => {
    const lines = diffLines('a\nb', 'a');
    expect(lines.some(l => l.type === 'del' && l.content === 'b')).toBe(true);
  });

  it('新增行', () => {
    const lines = diffLines('a', 'a\nb');
    expect(lines.some(l => l.type === 'add' && l.content === 'b')).toBe(true);
  });
});

describe('buildDiffFile', () => {
  it('新文件标记 new', () => {
    const f = buildDiffFile('x.txt', null, 'hello\nworld');
    expect(f.status).toBe('new');
    expect(f.additions).toBe(2);
    expect(f.deletions).toBe(0);
  });

  it('删除文件标记 deleted', () => {
    const f = buildDiffFile('x.txt', 'hello\nworld', null);
    expect(f.status).toBe('deleted');
    expect(f.additions).toBe(0);
    expect(f.deletions).toBe(2);
  });

  it('修改文件不标记 status', () => {
    const f = buildDiffFile('x.txt', 'a\nb', 'a\nc');
    expect(f.status).toBeUndefined();
    expect(f.additions).toBe(1);
    expect(f.deletions).toBe(1);
  });
});

describe('DiffSnapshotStore 恢复（回滚 agent 文件改动）', () => {
  let cwd: string;

  beforeAll(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'dscode-restore-'));
    await writeFile(join(cwd, 'keep.txt'), 'untouched', 'utf8');
    await writeFile(join(cwd, 'mod.txt'), 'original\nline2\n', 'utf8');
    await writeFile(join(cwd, 'del.txt'), 'to be deleted', 'utf8');
    await mkdir(join(cwd, 'sub'), { recursive: true });
    await writeFile(join(cwd, 'sub', 'nested.txt'), 'nested original', 'utf8');
  });

  afterAll(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('恢复到运行前：改写回原文、删除的重建、新增的清掉、未涉及的不动', async () => {
    const store = new DiffSnapshotStore();
    await store.initSnapshot('s1', cwd);
    expect(store.hasSnapshot('s1')).toBe(true);

    // 模拟 agent 运行期的改动：修改 / 删除 / 新增（含子目录新文件）
    await writeFile(join(cwd, 'mod.txt'), 'changed', 'utf8');
    await rm(join(cwd, 'del.txt'));
    await writeFile(join(cwd, 'new.txt'), 'created by agent', 'utf8');
    await writeFile(join(cwd, 'sub', 'nested.txt'), 'nested changed', 'utf8');

    const diff = await store.recomputeDiff('s1', cwd);
    expect(diff.map(f => f.path).sort()).toEqual(['del.txt', 'mod.txt', 'new.txt', 'sub/nested.txt']);

    const r = await store.restoreSnapshot('s1');
    expect(r.restored).toBe(4);
    // 恢复后 diff 应为空（所有差异都已回滚）
    expect(r.files).toEqual([]);

    await expect(readFile(join(cwd, 'mod.txt'), 'utf8')).resolves.toBe('original\nline2\n');
    await expect(readFile(join(cwd, 'del.txt'), 'utf8')).resolves.toBe('to be deleted');
    await expect(readFile(join(cwd, 'sub', 'nested.txt'), 'utf8')).resolves.toBe('nested original');
    await expect(readFile(join(cwd, 'keep.txt'), 'utf8')).resolves.toBe('untouched');
    // 运行期间新增的文件被删除
    await expect(readFile(join(cwd, 'new.txt'), 'utf8')).rejects.toThrow();
  });

  it('无快照时恢复为空操作', async () => {
    const store = new DiffSnapshotStore();
    const r = await store.restoreSnapshot('nope');
    expect(r.restored).toBe(0);
    expect(r.files).toEqual([]);
    expect(store.hasSnapshot('nope')).toBe(false);
  });

  it('clearSnapshot 放弃快照；快照数超上限时淘汰最旧', async () => {
    const store = new DiffSnapshotStore();
    await store.initSnapshot('a', cwd);
    await store.initSnapshot('b', cwd);
    store.clearSnapshot('a');
    expect(store.hasSnapshot('a')).toBe(false);
    expect(store.hasSnapshot('b')).toBe(true);

    // LRU：超过 MAX_SESSION_SNAPSHOTS 个会话快照时，最旧的被淘汰
    for (let i = 0; i < MAX_SESSION_SNAPSHOTS + 2; i++) {
      await store.initSnapshot(`sess-${i}`, cwd);
    }
    expect(store.hasSnapshot('b')).toBe(false); // b 最旧，已被淘汰
    expect(store.hasSnapshot(`sess-${MAX_SESSION_SNAPSHOTS + 1}`)).toBe(true);
  });
});
