import { stat, writeFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import { MAX_FILE_BYTES } from '../constants';
import { resolveSafePath } from '../workspace/paths';
import { STRING, strArg } from './types';
import type { Tool, ToolContext, ToolResult } from './types';

export const writeFileTool: Tool = {
  name: 'write_file',
  permission: 'write',
  description: '创建或整体覆盖工作目录内的文件',
  parameters: {
    type: 'object',
    properties: {
      path: { ...STRING, description: '相对工作目录的文件路径' },
      content: { ...STRING, description: '完整文件内容' }
    },
    required: ['path', 'content']
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const p = strArg(args, 'path');
    const content = args['content'];
    if (!p) return { ok: false, error: '缺少参数 path' };
    if (typeof content !== 'string') return { ok: false, error: '缺少参数 content' };
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
      return { ok: true, content: `已写入 ${rel}（${content.length} 字符）`, changedPaths: [rel] };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
};
