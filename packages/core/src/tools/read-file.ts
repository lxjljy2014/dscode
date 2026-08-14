import { readFileSync, statSync } from 'node:fs';
import { resolveSafePath } from '../workspace/paths';
import { truncate } from './format';
import { STRING, strArg } from './types';
import type { Tool, ToolContext, ToolResult } from './types';

/** 单文件读取上限（字节） */
const MAX_FILE_BYTES = 512 * 1024;

export const readFileTool: Tool = {
  name: 'read_file',
  permission: 'read',
  description: '读取工作目录内文件的内容（带行号）',
  parameters: {
    type: 'object',
    properties: { path: { ...STRING, description: '相对工作目录的文件路径' } },
    required: ['path']
  },
  execute(args: Record<string, unknown>, ctx: ToolContext): ToolResult {
    const p = strArg(args, 'path');
    if (!p) return { ok: false, error: '缺少参数 path' };
    const target = resolveSafePath(ctx.cwd, p);
    if (!target) return { ok: false, error: '路径不在工作目录内' };
    let stat;
    try {
      stat = statSync(target);
    } catch {
      return { ok: false, error: '文件不存在或无法访问' };
    }
    if (!stat.isFile()) return { ok: false, error: '目标不是文件' };
    if (stat.size > MAX_FILE_BYTES) return { ok: false, error: '文件过大（>512KB）' };
    try {
      const text = readFileSync(target, 'utf8');
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
