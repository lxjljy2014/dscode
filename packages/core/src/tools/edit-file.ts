import { readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { resolveSafePath } from '../workspace/paths';
import { STRING, strArg } from './types';
import type { Tool, ToolContext, ToolResult } from './types';

export const editFileTool: Tool = {
  name: 'edit_file',
  permission: 'write',
  description: '精确替换文件中唯一出现的一段内容（old_string 必须恰好匹配一次）',
  parameters: {
    type: 'object',
    properties: {
      path: { ...STRING, description: '相对工作目录的文件路径' },
      old_string: { ...STRING, description: '要被替换的原内容（需唯一匹配）' },
      new_string: { ...STRING, description: '替换后的新内容' }
    },
    required: ['path', 'old_string', 'new_string']
  },
  execute(args: Record<string, unknown>, ctx: ToolContext): ToolResult {
    const p = strArg(args, 'path');
    const oldString = args['old_string'];
    const newString = args['new_string'];
    if (!p) return { ok: false, error: '缺少参数 path' };
    if (typeof oldString !== 'string' || typeof newString !== 'string') {
      return { ok: false, error: '缺少参数 old_string / new_string' };
    }
    const target = resolveSafePath(ctx.cwd, p);
    if (!target) return { ok: false, error: '路径不在工作目录内' };
    let original: string;
    try {
      original = readFileSync(target, 'utf8');
    } catch {
      return { ok: false, error: '文件不存在或无法读取' };
    }
    const count = original.split(oldString).length - 1;
    if (count === 0) return { ok: false, error: 'old_string 未在文件中找到' };
    if (count > 1) return { ok: false, error: `old_string 匹配到 ${count} 处，请提供更多上下文使其唯一` };
    try {
      writeFileSync(target, original.replace(oldString, newString), 'utf8');
      return { ok: true, content: `已替换 ${relative(ctx.cwd, target)} 中的 1 处匹配` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
};
