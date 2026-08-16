import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { SKIP_DIRS, resolveSafePath } from '../workspace/paths';
import { defineTool } from './schema';
import type { ToolResult } from './types';

/** 单次列出的最大条目数 */
const MAX_DIR_ENTRIES = 200;
/** 递归深度上限 */
const LIST_DEPTH = 2;

export const listDirTool = defineTool({
  name: 'list_dir',
  permission: 'read',
  concurrency: 'parallel',
  description: '列出目录内容（递归两层，跳过 node_modules/.git/out/dist）',
  parameters: {
    path: { type: 'string', description: '相对工作目录的路径，默认根目录' },
  },
  async execute(args, ctx): Promise<ToolResult> {
    const base = args.path ? await resolveSafePath(ctx.cwd, args.path) : ctx.cwd;
    if (!base) return { ok: false, error: '路径不在工作目录内' };
    const lines: string[] = [];
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > LIST_DEPTH || lines.length >= MAX_DIR_ENTRIES) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      const dirs = entries
        .filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name))
        .sort((a, b) => a.name.localeCompare(b.name));
      const files = entries.filter(e => e.isFile()).sort((a, b) => a.name.localeCompare(b.name));
      for (const d of dirs) {
        lines.push(`${relative(ctx.cwd, join(dir, d.name))}/`);
        await walk(join(dir, d.name), depth + 1);
      }
      for (const f of files) lines.push(relative(ctx.cwd, join(dir, f.name)));
    };
    await walk(base, 0);
    const content = lines.length >= MAX_DIR_ENTRIES ? `${lines.join('\n')}\n……（条目过多，已截断）` : lines.join('\n');
    return {
      ok: true,
      content: content || '（空目录）',
      meta: { entryCount: lines.length, truncated: lines.length >= MAX_DIR_ENTRIES }
    };
  },
});
