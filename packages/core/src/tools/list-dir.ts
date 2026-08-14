import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SKIP_DIRS, resolveSafePath } from '../workspace/paths';
import { STRING, strArg } from './types';
import type { Tool, ToolContext, ToolResult } from './types';

/** 单次列出的最大条目数 */
const MAX_DIR_ENTRIES = 200;
/** 递归深度上限 */
const LIST_DEPTH = 2;

export const listDirTool: Tool = {
  name: 'list_dir',
  permission: 'read',
  description: '列出目录内容（递归两层，跳过 node_modules/.git/out/dist）',
  parameters: {
    type: 'object',
    properties: { path: { ...STRING, description: '相对工作目录的路径，默认根目录' } },
    required: []
  },
  execute(args: Record<string, unknown>, ctx: ToolContext): ToolResult {
    const p = strArg(args, 'path');
    const base = p ? resolveSafePath(ctx.cwd, p) : ctx.cwd;
    if (!base) return { ok: false, error: '路径不在工作目录内' };
    const lines: string[] = [];
    const walk = (dir: string, depth: number): void => {
      if (depth > LIST_DEPTH || lines.length >= MAX_DIR_ENTRIES) return;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      const dirs = entries.filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name)).sort((a, b) => a.name.localeCompare(b.name));
      const files = entries.filter(e => e.isFile()).sort((a, b) => a.name.localeCompare(b.name));
      for (const d of dirs) {
        lines.push(`${relative(ctx.cwd, join(dir, d.name))}/`);
        walk(join(dir, d.name), depth + 1);
      }
      for (const f of files) lines.push(relative(ctx.cwd, join(dir, f.name)));
    };
    walk(base, 0);
    const content = lines.length >= MAX_DIR_ENTRIES ? `${lines.join('\n')}\n……（条目过多，已截断）` : lines.join('\n');
    return { ok: true, content: content || '（空目录）' };
  }
};
