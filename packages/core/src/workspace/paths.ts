import { join, sep } from 'node:path';

/**
 * 工作区路径与遍历策略（文件系统域公共工具）。
 * 被工具集、工作区扫描与 diff 快照共同引用。
 */

/** 遍历与搜索时跳过的目录 */
export const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist']);

/** 把工具传入的路径限定在工作目录内（防目录穿越），越界返回 null */
export function resolveSafePath(cwd: string, p: string): string | null {
  const resolved = join(cwd, p);
  const prefix = cwd.endsWith(sep) ? cwd : cwd + sep;
  if (resolved !== cwd && !resolved.startsWith(prefix)) return null;
  return resolved;
}
