import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { FileNode } from '@dscode/shared';
import { MAX_FILE_BYTES } from '../constants';
import { SKIP_DIRS, resolveSafePath } from './paths';

/**
 * 真实工作区读取：文件树扫描与单文件读取（异步，避免阻塞主进程事件循环）。
 * 文件树按工作目录相对路径组织（与渲染端 FileTree 现有数据形态一致）。
 */

const MAX_DEPTH = 8;
const MAX_DIR_ENTRIES = 500;

/** 扫描工作目录为文件树（目录在前按名排序；跳过 node_modules/.git/out/dist） */
export async function scanTree(cwd: string): Promise<FileNode[]> {
  const walk = async (dir: string, depth: number): Promise<FileNode[]> => {
    if (depth > MAX_DEPTH) return [];
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
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
        children: await walk(full, depth + 1)
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
export async function readWorkspaceFile(
  cwd: string,
  relPath: string
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  const target = await resolveSafePath(cwd, relPath);
  if (!target) return { ok: false, error: '路径不在工作目录内' };
  try {
    const st = await stat(target);
    if (!st.isFile()) return { ok: false, error: '目标不是文件' };
    if (st.size > MAX_FILE_BYTES) return { ok: false, error: '文件过大（>512KB）' };
    return { ok: true, content: await readFile(target, 'utf8') };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
