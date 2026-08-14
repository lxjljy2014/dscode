import { readFile, stat } from 'node:fs/promises';
import { MAX_FILE_BYTES } from '../constants';
import { resolveSafePath } from '../workspace/paths';
import { truncate } from './format';
import { STRING, strArg } from './types';
import type { Tool, ToolContext, ToolResult } from './types';

export const readFileTool: Tool = {
  name: 'read_file',
  permission: 'read',
  description: '读取工作目录内文件的内容（带行号）',
  parameters: {
    type: 'object',
    properties: { path: { ...STRING, description: '相对工作目录的文件路径' } },
    required: ['path']
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const p = strArg(args, 'path');
    if (!p) return { ok: false, error: '缺少参数 path' };
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
      const numbered = text
        .split('\n')
        .map((line, i) => `${String(i + 1).padStart(4, ' ')} | ${line}`)
        .join('\n');
      return { ok: true, content: truncate(numbered) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
};
