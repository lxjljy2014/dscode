import { readFile, stat } from 'node:fs/promises';
import { MAX_FILE_BYTES } from '../constants';
import { resolveSafePath } from '../workspace/paths';
import { truncate } from './format';
import { defineTool } from './schema';
import type { ToolResult } from './types';

export const readFileTool = defineTool({
  name: 'read_file',
  permission: 'read',
  concurrency: 'parallel',
  description: '读取工作目录内文件的内容（带行号）',
  presentation: {
    presentCall: (args) => ({
      card: 'file',
      title: '读取文件',
      path: typeof args.path === 'string' ? args.path : '',
    }),
  },
  parameters: {
    path: { type: 'string', description: '相对工作目录的文件路径', required: true },
  },
  async execute(args, ctx): Promise<ToolResult> {
    const p = args.path;
    const target = await resolveSafePath(ctx.cwd, p);
    if (!target) return { ok: false, error: '路径不在工作目录内' };
    let st;
    try {
      st = await stat(target);
    } catch {
      return { ok: false, error: '文件不存在或无法访问' };
    }
    if (!st.isFile()) return { ok: false, error: '目标不是文件' };
    if (st.size > MAX_FILE_BYTES) return { ok: false, error: '文件过大（>512KB）' };
    try {
      const text = await readFile(target, 'utf8');
      const lines = text.split('\n');
      const numbered = lines.map((line, i) => `${String(i + 1).padStart(4, ' ')} | ${line}`).join('\n');
      // blocks：结构化行视图供 UI 渲染（带行号的代码块）；content 保持模型可见文本不变
      return {
        ok: true,
        content: truncate(numbered),
        meta: { path: p, lineCount: lines.length },
        blocks: [{ type: 'file', path: p }]
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
});
