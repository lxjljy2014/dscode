import { existsSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { resolveSafePath } from '../workspace/paths';
import { STRING, strArg } from './types';
import type { Tool, ToolContext, ToolResult } from './types';

/** 单文件写入上限（字节） */
const MAX_FILE_BYTES = 512 * 1024;

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
  execute(args: Record<string, unknown>, ctx: ToolContext): ToolResult {
    const p = strArg(args, 'path');
    const content = args['content'];
    if (!p) return { ok: false, error: '缺少参数 path' };
    if (typeof content !== 'string') return { ok: false, error: '缺少参数 content' };
    if (content.length > MAX_FILE_BYTES) return { ok: false, error: '内容过大（>512KB）' };
    const target = resolveSafePath(ctx.cwd, p);
    if (!target) return { ok: false, error: '路径不在工作目录内' };
    // 目标不存在时要求父目录已存在，避免误写进错误层级
    const parent = join(target, '..');
    if (!existsSync(parent)) return { ok: false, error: '父目录不存在' };
    try {
      writeFileSync(target, content, 'utf8');
      return { ok: true, content: `已写入 ${relative(ctx.cwd, target)}（${content.length} 字符）` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
};
