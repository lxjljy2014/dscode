import { readFile, stat, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { MAX_FILE_BYTES } from '../constants';
import { resolveSafePath } from '../workspace/paths';
import { defineTool } from './schema';
import type { ToolResult } from './types';

export const editFileTool = defineTool({
  name: 'edit_file',
  permission: 'write',
  description: '精确替换文件中唯一出现的一段内容（old_string 必须恰好匹配一次）',
  presentation: {
    presentCall: (args) => ({
      card: 'diff',
      title: '编辑文件',
      path: typeof args.path === 'string' ? args.path : '',
      oldText: typeof args.old_string === 'string' ? args.old_string : '',
      newText: typeof args.new_string === 'string' ? args.new_string : '',
    }),
  },
  parameters: {
    path: { type: 'string', description: '相对工作目录的文件路径', required: true },
    old_string: { type: 'string', description: '要被替换的原内容（需唯一匹配）', required: true },
    new_string: { type: 'string', description: '替换后的新内容', required: true },
  },
  async execute(args, ctx): Promise<ToolResult> {
    const { path: p, old_string: oldString, new_string: newString } = args;
    const target = await resolveSafePath(ctx.cwd, p);
    if (!target) return { ok: false, error: '路径不在工作目录内' };
    let original: string;
    try {
      const st = await stat(target);
      if (!st.isFile()) return { ok: false, error: '目标不是文件' };
      if (st.size > MAX_FILE_BYTES) return { ok: false, error: '文件过大（>512KB）' };
      original = await readFile(target, 'utf8');
    } catch {
      return { ok: false, error: '文件不存在或无法读取' };
    }
    const count = original.split(oldString).length - 1;
    if (count === 0) return { ok: false, error: 'old_string 未在文件中找到' };
    if (count > 1) return { ok: false, error: `old_string 匹配到 ${count} 处，请提供更多上下文使其唯一` };
    try {
      // 函数式替换：避免把 new_string 里的 $&/$$/$`/$' 当特殊模式展开（会静默损坏 shell/Makefile/模板文件）
      const replaced = original.replace(oldString, () => newString);
      await writeFile(target, replaced, 'utf8');
      const rel = relative(ctx.cwd, target);
      return {
        ok: true,
        content: `已替换 ${rel} 中的 1 处匹配`,
        changedPaths: [rel],
        meta: { path: rel, replaced: 1 },
        blocks: [{ type: 'diff', path: rel, oldText: original, newText: replaced }]
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
});
