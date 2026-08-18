import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkout, createBranch, graph, isGitRepo, listBranches } from '../src/git/git';

const execFileP = promisify(execFile);

let repo: string;
let nonGit: string;

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', args, { cwd: repo });
  return stdout;
}

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'dscode-git-'));
  nonGit = await mkdtemp(join(tmpdir(), 'dscode-nongit-'));
  await git(['init', '-b', 'main']);
  await git(['config', 'user.email', 'test@example.com']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repo, 'a.txt'), 'hello', 'utf8');
  await git(['add', '.']);
  await git(['commit', '-m', 'init']);
  await git(['checkout', '-b', 'feature']);
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
  await rm(nonGit, { recursive: true, force: true });
});

describe('git 封装（真实临时仓库）', () => {
  it('isGitRepo 探测', async () => {
    expect(await isGitRepo(repo)).toBe(true);
    expect(await isGitRepo(nonGit)).toBe(false);
  });

  it('listBranches 列出当前与全部分支', async () => {
    const r = await listBranches(repo);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.current).toBe('feature');
      expect(r.branches).toContain('main');
      expect(r.branches).toContain('feature');
    }
  });

  it('checkout 切换分支', async () => {
    expect(await checkout(repo, 'main')).toEqual({ ok: true });
    const r = await listBranches(repo);
    if (r.ok) expect(r.current).toBe('main');
  });

  it('createBranch 创建并切换', async () => {
    expect(await createBranch(repo, 'dev')).toEqual({ ok: true });
    const r = await listBranches(repo);
    if (r.ok) expect(r.current).toBe('dev');
  });

  it('graph 返回提交图', async () => {
    const r = await graph(repo);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.graph.length).toBeGreaterThan(0);
      expect(r.graph[0]?.hash).toBeTruthy();
    }
  });

  it('非 git 仓库返回错误', async () => {
    const r = await listBranches(nonGit);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('not a git repository');
  });
});
