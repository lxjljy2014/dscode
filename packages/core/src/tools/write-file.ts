import { stat, writeFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import { MAX_FILE_BYTES } from '../constants';
import { resolveSafePath } from '../workspace/paths';
import { defineTool } from './schema';
import type { ToolResult } from './types';

export const writeFileTool = defineTool({
  name: 'write_file',
  permission: 'write',
  description: '创建或整体覆盖工作目录内的文件',
  presentation: {
    presentCall: (args) => ({
      card: 'diff',
      title: '写入文件',
      path: typeof args.path === 'string' ? args.path : '',
      oldText: null,
      newText: typeof args.content === 'string' ? args.content : '',
    }),
  },
  parameters: {
    path: { type: 'string', description: '相对工作目录的文件路径', required: true },
    content: { type: 'string', description: '完整文件内容', required: true },
  },
  async execute(args, ctx): Promise<ToolResult> {
    const { path: p, content } = args;
    if (content.length > MAX_FILE_BYTES) return { ok: false, error: '内容过大（>512KB）' };
    const target = await resolveSafePath(ctx.cwd, p);
    if (!target) return { ok: false, error: '路径不在工作目录内' };
    // 目标不存在时要求父目录已存在，避免误写进错误层级
    try {
      await stat(dirname(target));
    } catch {
      return { ok: false, error: '父目录不存在' };
    }
    try {
      await writeFile(target, content, 'utf8');
      const rel = relative(ctx.cwd, target);
      return {
        ok: true,
        content: `已写入 ${rel}（${content.length} 字符）`,
        changedPaths: [rel],
        meta: { path: rel, chars: content.length },
        blocks: [{ type: 'diff', path: rel, oldText: null, newText: content }]
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
});
