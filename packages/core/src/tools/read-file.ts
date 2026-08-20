import { readFile, stat } from 'node:fs/promises';
import { READ_MAX_FILE_BYTES } from '../constants';
import { resolveSafePath } from '../workspace/paths';
import { truncate } from './format';
import { defineTool } from './schema';
import type { ToolResult } from './types';

/** 默认读取行数（与输出字符上限 24K 匹配：常规代码行长约 50 字符时接近但不超过） */
const DEFAULT_READ_LINES = 500;
/** 单次读取的最大行数 */
const MAX_READ_LINES = 2000;

export const readFileTool = defineTool({
  name: 'read_file',
  permission: 'read',
  concurrency: 'parallel',
  description:
    '读取工作目录内文件的内容（带行号，按行分页）。默认返回第 1-500 行；大文件用 offset（1 起始的行号）与 limit（行数，最大 2000）翻页读取',
  presentation: {
    presentCall: args => ({
      card: 'file',
      title: '读取文件',
      path: typeof args.path === 'string' ? args.path : '',
      line: typeof args.offset === 'number' ? args.offset : undefined
    }),
  },
  parameters: {
    path: { type: 'string', description: '相对工作目录的文件路径', required: true },
    offset: { type: 'integer', description: '起始行号（1 起始，默认 1）' },
    limit: { type: 'integer', description: `读取行数（默认 ${DEFAULT_READ_LINES}，最大 ${MAX_READ_LINES}）` }
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
    if (st.size > READ_MAX_FILE_BYTES) {
      return { ok: false, error: `文件过大（>${READ_MAX_FILE_BYTES / 1024 / 1024}MB），请用 search 工具定位相关内容` };
    }
    // offset/limit 收敛到合法区间（负数/小数取整，超上限钳制）
    const offset = Math.max(1, Math.floor(args.offset ?? 1));
    const limit = Math.min(MAX_READ_LINES, Math.max(1, Math.floor(args.limit ?? DEFAULT_READ_LINES)));
    try {
      const text = await readFile(target, 'utf8');
      const lines = text.split('\n');
      const startIdx = Math.min(offset - 1, lines.length);
      const endIdx = Math.min(startIdx + limit, lines.length);
      const slice = lines.slice(startIdx, endIdx);
      if (slice.length === 0) {
        return { ok: false, error: `offset=${offset} 超出文件总行数（共 ${lines.length} 行）` };
      }
      const numbered = slice.map((line, i) => `${String(startIdx + i + 1).padStart(4, ' ')} | ${line}`).join('\n');
      // 分页提示放正文尾部：模型据此继续翻页，无需额外调用探测
      const footer =
        endIdx < lines.length
          ? `\n……（共 ${lines.length} 行，已展示第 ${startIdx + 1}-${endIdx} 行；继续读取用 offset=${endIdx + 1}）`
          : '';
      return {
        ok: true,
        content: truncate(numbered + footer),
        meta: { path: p, lineCount: lines.length, offset: startIdx + 1, limit: slice.length, hasMore: endIdx < lines.length },
        blocks: [{ type: 'file', path: p }]
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
});
