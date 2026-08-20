import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { searchTool } from '../src/tools/search';

/** search：子串/正则/文件过滤/每文件命中上限/全局截断/跳过目录 */

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'dscode-search-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe('searchTool 内容搜索', () => {
  it('子串匹配不区分大小写，输出带行号与摘录', async () => {
    await writeFile(join(cwd, 'a.ts'), 'const Foo = 1;\nlet bar = Foo + 2;\n', 'utf8');
    const r = await searchTool.execute({ query: 'foo' }, { cwd });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toContain('a.ts:1:');
    expect(r.content).toContain('a.ts:2:');
  });

  it('regex=true 按正则匹配；非法正则报错', async () => {
    await writeFile(join(cwd, 'a.ts'), 'const abc123 = 1;\n', 'utf8');
    const r = await searchTool.execute({ query: 'abc\\d+', regex: true }, { cwd });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toContain('a.ts:1');
    const bad = await searchTool.execute({ query: '([unclosed', regex: true }, { cwd });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error).toContain('正则表达式无效');
  });

  it('include 过滤：扩展名列表与通配两种写法', async () => {
    await writeFile(join(cwd, 'a.ts'), 'needle here\n', 'utf8');
    await writeFile(join(cwd, 'b.js'), 'needle here\n', 'utf8');
    await writeFile(join(cwd, 'c.test.ts'), 'needle here\n', 'utf8');

    const extList = await searchTool.execute({ query: 'needle', include: 'ts,tsx' }, { cwd });
    expect(extList.ok).toBe(true);
    if (!extList.ok) return;
    expect(extList.content).toContain('a.ts');
    expect(extList.content).toContain('c.test.ts');
    expect(extList.content).not.toContain('b.js');

    const wildcard = await searchTool.execute({ query: 'needle', include: '*.test.ts' }, { cwd });
    expect(wildcard.ok).toBe(true);
    if (!wildcard.ok) return;
    expect(wildcard.content).toContain('c.test.ts');
    expect(wildcard.content).not.toContain('a.ts:');
  });

  it('单文件命中数受每文件上限约束', async () => {
    const many = Array.from({ length: 40 }, () => 'repeat match line').join('\n');
    await writeFile(join(cwd, 'big.txt'), many, 'utf8');
    const r = await searchTool.execute({ query: 'match' }, { cwd });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const count = (r.content.match(/big\.txt:\d+:/g) ?? []).length;
    expect(count).toBe(10);
  });

  it('全局命中截断到上限并注明', async () => {
    await mkdir(join(cwd, 'd1'), { recursive: true });
    await mkdir(join(cwd, 'd2'), { recursive: true });
    for (let i = 0; i < 60; i++) {
      await writeFile(join(cwd, `f${i}.txt`), 'target content\n', 'utf8');
    }
    const r = await searchTool.execute({ query: 'target' }, { cwd });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toContain('已截断');
    expect(r.meta).toMatchObject({ hitCount: 50 });
  });

  it('跳过依赖与构建产物目录', async () => {
    await mkdir(join(cwd, 'node_modules/pkg'), { recursive: true });
    await mkdir(join(cwd, 'dist'), { recursive: true });
    await mkdir(join(cwd, '__pycache__'), { recursive: true });
    await writeFile(join(cwd, 'node_modules/pkg/index.js'), 'hidden target\n', 'utf8');
    await writeFile(join(cwd, 'dist/out.js'), 'hidden target\n', 'utf8');
    await writeFile(join(cwd, '__pycache__/c.pyc'), 'hidden target\n', 'utf8');
    await writeFile(join(cwd, 'src.ts'), 'visible target\n', 'utf8');
    const r = await searchTool.execute({ query: 'target' }, { cwd });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toContain('src.ts');
    expect(r.content).not.toContain('node_modules');
    expect(r.content).not.toContain('dist');
    expect(r.content).not.toContain('__pycache__');
  });

  it('文件名匹配直接命中（不含内容的文件名）', async () => {
    await writeFile(join(cwd, 'FindMe.ts'), 'no content match\n', 'utf8');
    const r = await searchTool.execute({ query: 'findme' }, { cwd });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toContain('FindMe.ts');
  });

  it('起始路径限定搜索范围；越界路径被拒', async () => {
    await mkdir(join(cwd, 'sub'), { recursive: true });
    await writeFile(join(cwd, 'root.txt'), 'needle\n', 'utf8');
    await writeFile(join(cwd, 'sub/inner.txt'), 'needle\n', 'utf8');
    const r = await searchTool.execute({ query: 'needle', path: 'sub' }, { cwd });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toContain('sub/inner.txt');
    expect(r.content).not.toContain('root.txt');
    const bad = await searchTool.execute({ query: 'x', path: '../outside' }, { cwd });
    expect(bad.ok).toBe(false);
  });

  it('无匹配返回空结果说明', async () => {
    await writeFile(join(cwd, 'a.txt'), 'nothing\n', 'utf8');
    const r = await searchTool.execute({ query: 'zzz-not-exist' }, { cwd });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toContain('无匹配');
  });
});
