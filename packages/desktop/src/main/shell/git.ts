import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitGraphResult, GitListResult, GitOpResult } from '@dscode/shared';

const execFileP = promisify(execFile);

/** git CLI 统一入口：参数数组传递（不经 shell，无注入风险），非 git 仓库时 git 本身会输出到 stderr */
function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileP('git', args, { cwd, windowsHide: true });
}

/** 探测目录是否为 git 仓库 */
export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

/** 列出当前分支与全部分支 */
export async function listBranches(cwd: string): Promise<GitListResult> {
  try {
    if (!(await isGitRepo(cwd))) {
      return { ok: false, error: 'not a git repository' };
    }
    const [currentRes, branchesRes] = await Promise.all([
      runGit(cwd, ['branch', '--show-current']),
      runGit(cwd, ['branch', '--format=%(refname:short)'])
    ]);
    return {
      ok: true,
      current: currentRes.stdout.trim(),
      branches: branchesRes.stdout
        .split('\n')
        .map(b => b.trim())
        .filter(Boolean)
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 切换分支 */
export async function checkout(cwd: string, branch: string): Promise<GitOpResult> {
  try {
    await runGit(cwd, ['checkout', branch]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 创建并检出新分支 */
export async function createBranch(cwd: string, name: string): Promise<GitOpResult> {
  try {
    await runGit(cwd, ['checkout', '-b', name]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * git log --graph 结构化图谱。
 * pretty 格式以 @ 起始、\x1f 分隔字段，解析出图/提交id/作者/日期/主题五行对齐。
 */
export async function graph(cwd: string): Promise<GitGraphResult> {
  try {
    if (!(await isGitRepo(cwd))) {
      return { ok: false, error: 'not a git repository' };
    }
    const { stdout } = await runGit(cwd, [
      'log',
      '--graph',
      '--all',
      '--no-color',
      '--date=short',
      '--pretty=format:@@%h%x1f%an%x1f%ad%x1f%s',
      '--max-count=100'
    ]);
    const rows = stdout
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const at = line.indexOf('@@');
        const graphPart = at >= 0 ? line.slice(0, at) : line;
        const rest = at >= 0 ? line.slice(at + 2) : line;
        const [hash = '', author = '', date = '', subject = ''] = rest.split('\x1f');
        return { graph: graphPart, hash, author, date, subject };
      });
    return { ok: true, graph: rows };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
