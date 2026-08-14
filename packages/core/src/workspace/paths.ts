import { realpath, stat } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';

/**
 * 工作区路径与遍历策略（文件系统域公共工具）。
 * 被工具集、工作区扫描与 diff 快照共同引用。
 */

/** 遍历与搜索时跳过的目录 */
export const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist']);

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 把工具传入的路径限定在工作目录内（防目录穿越），越界返回 null。
 * 双保险：
 * 1. 词法层：join 后必须仍以 cwd 为前缀，挡掉 ../ 等直接越界；
 * 2. 真实路径层：对 cwd 与目标解析 realpath（跟随软链接），
 *    防止工作目录内的软链接指向目录外被读写。
 * 目标可能尚不存在（write_file 新建），此时向上取最近存在的祖先解析真实路径。
 */
export async function resolveSafePath(cwd: string, p: string): Promise<string | null> {
  const resolved = join(cwd, p);
  const prefix = cwd.endsWith(sep) ? cwd : cwd + sep;
  if (resolved !== cwd && !resolved.startsWith(prefix)) return null;
  try {
    const realCwd = await realpath(cwd);
    const realPrefix = realCwd.endsWith(sep) ? realCwd : realCwd + sep;

    let cur = resolved;
    while (!(await exists(cur))) {
      const parent = dirname(cur);
      if (parent === cur) return null;
      cur = parent;
    }
    const realTarget = await realpath(cur);
    if (realTarget !== realCwd && !realTarget.startsWith(realPrefix)) return null;
    return resolved;
  } catch {
    // 无法解析真实路径（权限 / IO 错误）时保守拒绝
    return null;
  }
}
