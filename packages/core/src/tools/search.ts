import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SKIP_DIRS, resolveSafePath } from '../workspace/paths';
import { STRING, strArg } from './types';
import type { Tool, ToolContext, ToolResult } from './types';

/** 最多命中数 */
const MAX_SEARCH_HITS = 50;
/** 参与内容搜索的单文件大小上限（字节） */
const SEARCH_MAX_FILE_BYTES = 256 * 1024;

export const searchTool: Tool = {
  name: 'search',
  permission: 'read',
  description: '在工作目录内搜索文件名或文件内容（不区分大小写）',
  parameters: {
    type: 'object',
    properties: {
      query: { ...STRING, description: '搜索关键词' },
      path: { ...STRING, description: '相对工作目录的起始路径，默认根目录' }
    },
    required: ['query']
  },
  execute(args: Record<string, unknown>, ctx: ToolContext): ToolResult {
    const q = strArg(args, 'query');
    if (!q) return { ok: false, error: '缺少参数 query' };
    const p = strArg(args, 'path');
    const base = p ? resolveSafePath(ctx.cwd, p) : ctx.cwd;
    if (!base) return { ok: false, error: '路径不在工作目录内' };
    const needle = q.toLowerCase();
    const hits: string[] = [];
    const walk = (dir: string): void => {
      if (hits.length >= MAX_SEARCH_HITS) return;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (hits.length >= MAX_SEARCH_HITS) return;
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name));
          continue;
        }
        if (!e.isFile()) continue;
        const full = join(dir, e.name);
        const rel = relative(ctx.cwd, full);
        if (e.name.toLowerCase().includes(needle)) {
          hits.push(rel);
          continue;
        }
        try {
          const stat = statSync(full);
          if (stat.size > SEARCH_MAX_FILE_BYTES) return;
          const text = readFileSync(full, 'utf8');
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
    walk(base);
    const content = hits.length >= MAX_SEARCH_HITS ? `${hits.join('\n')}\n……（命中过多，已截断）` : hits.join('\n');
    return { ok: true, content: content || '（无匹配结果）' };
  }
};
