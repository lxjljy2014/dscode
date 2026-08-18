import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readWorkspaceFile, scanTree } from '../src/workspace/workspace';

let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'dscode-ws-'));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe('scanTree', () => {
  it('扫描目录为文件树并跳过 node_modules/.git', async () => {
    await writeFile(join(cwd, 'a.txt'), 'a');
    await mkdir(join(cwd, 'src'));
    await writeFile(join(cwd, 'src', 'b.ts'), 'b');
    await mkdir(join(cwd, 'node_modules'));
    await writeFile(join(cwd, 'node_modules', 'x.js'), 'x');
    const tree = await scanTree(cwd);
    const names = tree.map(n => n.name);
    expect(names).toContain('a.txt');
    expect(names).toContain('src');
    expect(names).not.toContain('node_modules');
  });
});

describe('readWorkspaceFile', () => {
  it('读取工作目录内文件', async () => {
    await writeFile(join(cwd, 'f.txt'), 'hello', 'utf8');
    expect(await readWorkspaceFile(cwd, 'f.txt')).toEqual({ ok: true, content: 'hello' });
  });

  it('拒绝目录穿越', async () => {
    const r = await readWorkspaceFile(cwd, '../secret.txt');
    expect(r.ok).toBe(false);
  });

  it('拒绝不存在的文件', async () => {
    const r = await readWorkspaceFile(cwd, 'nope.txt');
    expect(r.ok).toBe(false);
  });
});
