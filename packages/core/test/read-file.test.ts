import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileTool } from '../src/tools/read-file';

/** read_file：行分页（offset/limit）、行号正确性、越界与大文件防护 */

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'dscode-read-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe('readFileTool 分页', () => {
  it('默认返回前 500 行并提示翻页', async () => {
    const lines = Array.from({ length: 600 }, (_, i) => `line ${i + 1}`);
    await writeFile(join(cwd, 'big.txt'), lines.join('\n'), 'utf8');
    const r = await readFileTool.execute({ path: 'big.txt' }, { cwd });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toContain('   1 | line 1');
    expect(r.content).toContain(' 500 | line 500');
    expect(r.content).not.toContain('line 501\n');
    expect(r.content).toContain('offset=501');
    // 600 行内容无结尾换行：split('\n') 得 600 个元素
    expect(r.meta).toMatchObject({ lineCount: 600, offset: 1, limit: 500, hasMore: true });
  });

  it('offset/limit 翻页：行号为真实行号且区间正确', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `row ${i + 1}`);
    await writeFile(join(cwd, 'a.txt'), lines.join('\n'), 'utf8');
    const r = await readFileTool.execute({ path: 'a.txt', offset: 90, limit: 5 }, { cwd });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toContain(' 90 | row 90');
    expect(r.content).toContain(' 94 | row 94');
    expect(r.content).not.toContain('row 95');
    expect(r.content).toContain('offset=95');
    expect(r.meta).toMatchObject({ offset: 90, limit: 5, hasMore: true });
  });

  it('读到文件末尾：hasMore=false 且无翻页提示', async () => {
    await writeFile(join(cwd, 'a.txt'), 'a\nb\nc', 'utf8');
    const r = await readFileTool.execute({ path: 'a.txt', offset: 2, limit: 10 }, { cwd });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).not.toContain('offset=');
    expect(r.meta).toMatchObject({ lineCount: 3, offset: 2, limit: 2, hasMore: false });
  });

  it('offset 超出总行数报错并说明总行数', async () => {
    await writeFile(join(cwd, 'a.txt'), 'a\nb', 'utf8');
    const r = await readFileTool.execute({ path: 'a.txt', offset: 99 }, { cwd });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('总行数');
  });

  it('limit 超上限被钳制到 2000，非法值收敛为默认', async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `x${i}`);
    await writeFile(join(cwd, 'a.txt'), lines.join('\n'), 'utf8');
    const r = await readFileTool.execute({ path: 'a.txt', limit: 99999, offset: -3 }, { cwd });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // offset=-3 收敛为 1；limit 钳制后仍小于文件行数，全部读出
    expect(r.meta).toMatchObject({ offset: 1, limit: 10, hasMore: false });
  });

  it('目录与不存在路径报错', async () => {
    await mkdir(join(cwd, 'sub'), { recursive: true });
    const dir = await readFileTool.execute({ path: 'sub' }, { cwd });
    expect(dir.ok).toBe(false);
    const missing = await readFileTool.execute({ path: 'nope.txt' }, { cwd });
    expect(missing.ok).toBe(false);
  });

  it('路径穿越被拒', async () => {
    await writeFile(join(cwd, 'a.txt'), 'x', 'utf8');
    const r = await readFileTool.execute({ path: '../a.txt' }, { cwd });
    expect(r.ok).toBe(false);
  });
});
