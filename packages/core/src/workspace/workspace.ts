import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
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

// ---- 工作区文件操作（文件树右键菜单：新建/重命名；均限定工作目录内） ----

/** 新建空文件（父目录不存在时自动创建；目标已存在时报错） */
export async function createWorkspaceFile(
  cwd: string,
  relPath: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const target = await resolveSafePath(cwd, relPath);
  if (!target) return { ok: false, error: '路径不在工作目录内' };
  try {
    if (await exists(target)) return { ok: false, error: '目标已存在' };
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, '', 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 新建目录（recursive；目标已存在时报错） */
export async function createWorkspaceDir(
  cwd: string,
  relPath: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const target = await resolveSafePath(cwd, relPath);
  if (!target) return { ok: false, error: '路径不在工作目录内' };
  try {
    if (await exists(target)) return { ok: false, error: '目标已存在' };
    await mkdir(target, { recursive: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 重命名/移动（目标已存在、目标越界均报错） */
export async function renameWorkspaceEntry(
  cwd: string,
  from: string,
  to: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const src = await resolveSafePath(cwd, from);
  const dst = await resolveSafePath(cwd, to);
  if (!src || !dst) return { ok: false, error: '路径不在工作目录内' };
  try {
    if (!(await exists(src))) return { ok: false, error: '原路径不存在' };
    if (await exists(dst)) return { ok: false, error: '目标已存在' };
    await mkdir(dirname(dst), { recursive: true });
    await rename(src, dst);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 删除前置校验：路径存在且在工作目录内，返回绝对路径（删除动作由宿主执行，如移入回收站） */
export async function resolveWorkspaceEntryForDelete(
  cwd: string,
  relPath: string
): Promise<{ ok: true; target: string } | { ok: false; error: string }> {
  const target = await resolveSafePath(cwd, relPath);
  if (!target) return { ok: false, error: '路径不在工作目录内' };
  if (!(await exists(target))) return { ok: false, error: '目标不存在' };
  // 根目录本身不可删（relPath 为空/点号时 join 得 cwd）
  if (target === resolve(cwd)) return { ok: false, error: '不能删除工作目录根' };
  return { ok: true, target };
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
