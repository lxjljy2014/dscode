import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { FileNode } from '@dscode/shared';
import { SKIP_DIRS, resolveSafePath } from '../agent/agent-tools';

/**
 * 真实工作区读取：文件树扫描与单文件读取。
 * 文件树按工作目录相对路径组织（与渲染端 FileTree 现有数据形态一致）。
 */

const MAX_DEPTH = 8;
const MAX_DIR_ENTRIES = 500;
const MAX_FILE_BYTES = 512 * 1024;

/** 扫描工作目录为文件树（目录在前按名排序；跳过 node_modules/.git/out/dist） */
export function scanTree(cwd: string): FileNode[] {
  const walk = (dir: string, depth: number): FileNode[] => {
    if (depth > MAX_DEPTH) return [];
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const nodes: FileNode[] = [];
    const dirs = entries
      .filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    const files = entries.filter(e => e.isFile()).sort((a, b) => a.name.localeCompare(b.name));
    for (const d of dirs.slice(0, MAX_DIR_ENTRIES)) {
      const full = join(dir, d.name);
      nodes.push({
        name: d.name,
        path: relative(cwd, full),
        type: 'dir',
        children: walk(full, depth + 1)
      });
    }
    for (const f of files.slice(0, MAX_DIR_ENTRIES - nodes.length)) {
      const full = join(dir, f.name);
      nodes.push({ name: f.name, path: relative(cwd, full), type: 'file' });
    }
    return nodes;
  };
  return walk(cwd, 0);
}

/** 读取工作目录内的单个文件（UTF-8，≤512KB，越界/过大拒绝） */
export function readWorkspaceFile(
  cwd: string,
  relPath: string
): { ok: true; content: string } | { ok: false; error: string } {
  const target = resolveSafePath(cwd, relPath);
  if (!target) return { ok: false, error: '路径不在工作目录内' };
  try {
    const stat = statSync(target);
    if (!stat.isFile()) return { ok: false, error: '目标不是文件' };
    if (stat.size > MAX_FILE_BYTES) return { ok: false, error: '文件过大（>512KB）' };
    return { ok: true, content: readFileSync(target, 'utf8') };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
