import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { SKIP_DIRS, resolveSafePath } from '../workspace/paths';
import { defineTool } from './schema';
import type { ToolResult } from './types';

/** 最多命中数 */
const MAX_SEARCH_HITS = 50;
/** 参与内容搜索的单文件大小上限（字节） */
const SEARCH_MAX_FILE_BYTES = 256 * 1024;
/** 递归深度上限（此前无限制，深目录会无限递归） */
const SEARCH_MAX_DEPTH = 16;
/** 参与搜索的最大文件数（防止超大目录长时间遍历） */
const SEARCH_MAX_FILES = 20_000;

export const searchTool = defineTool({
  name: 'search',
  permission: 'read',
  concurrency: 'parallel',
  description: '在工作目录内搜索文件名或文件内容（不区分大小写）',
  parameters: {
    query: { type: 'string', description: '搜索关键词', required: true },
    path: { type: 'string', description: '相对工作目录的起始路径，默认根目录' },
  },
  async execute(args, ctx): Promise<ToolResult> {
    const q = args.query;
    const base = args.path ? await resolveSafePath(ctx.cwd, args.path) : ctx.cwd;
    if (!base) return { ok: false, error: '路径不在工作目录内' };
    const needle = q.toLowerCase();
    const hits: string[] = [];
    let visitedFiles = 0;
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (hits.length >= MAX_SEARCH_HITS || depth > SEARCH_MAX_DEPTH || visitedFiles >= SEARCH_MAX_FILES) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (hits.length >= MAX_SEARCH_HITS || visitedFiles >= SEARCH_MAX_FILES) return;
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) await walk(join(dir, e.name), depth + 1);
          continue;
        }
        if (!e.isFile()) continue;
        visitedFiles++;
        const full = join(dir, e.name);
        const rel = relative(ctx.cwd, full);
        if (e.name.toLowerCase().includes(needle)) {
          hits.push(rel);
          continue;
        }
        try {
          const st = await stat(full);
          if (st.size > SEARCH_MAX_FILE_BYTES) continue;
          const text = await readFile(full, 'utf8');
          const lines = text.split('\n');
          for (let i = 0; i < lines.length && hits.length < MAX_SEARCH_HITS; i++) {
            const line = lines[i];
            const idx = line.toLowerCase().indexOf(needle);
            if (idx >= 0) {
              const start = Math.max(0, idx - 30);
              const excerpt = line.slice(start, idx + q.length + 60).trim();
              hits.push(`${rel}:${i + 1}: ${excerpt}`);
            }
          }
        } catch {
          // 二进制/不可读文件跳过
        }
      }
    };
    await walk(base, 0);
    const content = hits.length >= MAX_SEARCH_HITS ? `${hits.join('\n')}\n……（命中过多，已截断）` : hits.join('\n');
    return { ok: true, content: content || '（无匹配结果）', meta: { hitCount: hits.length } };
  },
});
