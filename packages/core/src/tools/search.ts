import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { SKIP_DIRS, resolveSafePath } from '../workspace/paths';
import { defineTool } from './schema';
import type { ToolResult } from './types';

/** 最多命中数 */
const MAX_SEARCH_HITS = 50;
/** 单文件最多贡献的命中数（防单个大文件刷屏耗尽全局预算） */
const MAX_HITS_PER_FILE = 10;
/** 参与内容搜索的单文件大小上限（字节） */
const SEARCH_MAX_FILE_BYTES = 256 * 1024;
/** 递归深度上限（此前无限制，深目录会无限递归） */
const SEARCH_MAX_DEPTH = 16;
/** 参与搜索的最大文件数（防止超大目录长时间遍历） */
const SEARCH_MAX_FILES = 20_000;

/**
 * 解析 include 过滤为「后缀集合 + 通配模式」两种匹配：
 * 支持 `*.ts`（通配）、`*.test.ts`（多段通配）与 `ts,tsx`（裸扩展名）写法，混用亦可。
 */
function parseInclude(include: string): (fileName: string) => boolean {
  const parts = include
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => s.length > 0);
  const suffixes = new Set<string>();
  const patterns: string[] = [];
  for (const part of parts) {
    if (part.includes('*')) patterns.push(part);
    else suffixes.add(part.startsWith('.') ? part : `.${part}`); // "ts" / ".ts" → ".ts"
  }
  return (fileName: string): boolean => {
    const lower = fileName.toLowerCase();
    for (const suf of suffixes) {
      if (lower.endsWith(suf)) return true;
    }
    return patterns.some(p => matchWildcard(lower, p));
  };
}

/** 极简通配匹配：仅支持 `*`（任意序列），按段切分后逐段前后缀比对 */
function matchWildcard(s: string, pattern: string): boolean {
  const segs = pattern.split('*');
  if (segs.length === 1) return s === pattern;
  let idx = 0;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    if (i === 0) {
      if (!s.startsWith(seg)) return false;
      idx = seg.length;
    } else if (i === segs.length - 1) {
      return s.slice(idx).endsWith(seg) && s.length - idx >= seg.length;
    } else {
      const found = s.indexOf(seg, idx);
      if (found < 0) return false;
      idx = found + seg.length;
    }
  }
  return true;
}

export const searchTool = defineTool({
  name: 'search',
  permission: 'read',
  concurrency: 'parallel',
  description:
    '在工作目录内搜索文件名或文件内容（默认不区分大小写的子串匹配；regex=true 时按正则匹配；include 可按扩展名过滤，如 "*.ts" 或 "ts,tsx"）',
  parameters: {
    query: { type: 'string', description: '搜索关键词（或 regex=true 时的正则表达式）', required: true },
    path: { type: 'string', description: '相对工作目录的起始路径，默认根目录' },
    include: { type: 'string', description: '文件名过滤：扩展名列表（"ts,tsx"）或通配（"*.test.ts"），仅命中的文件参与搜索' },
    regex: { type: 'boolean', description: 'query 按正则匹配（默认 false 子串匹配）' }
  },
  async execute(args, ctx): Promise<ToolResult> {
    const q = args.query;
    const base = args.path ? await resolveSafePath(ctx.cwd, args.path) : ctx.cwd;
    if (!base) return { ok: false, error: '路径不在工作目录内' };
    // 匹配器：子串（小写化）或正则（编译失败直接报错，模型可改写 pattern）；文件名与行内容共用同一实例
    let nameRe: RegExp | null = null;
    let needle = '';
    let matcher: (line: string) => number;
    if (args.regex === true) {
      try {
        nameRe = new RegExp(q, 'i');
      } catch (e) {
        return { ok: false, error: `正则表达式无效：${e instanceof Error ? e.message : String(e)}` };
      }
      const re = nameRe;
      matcher = (line): number => {
        const m = re.exec(line);
        return m ? m.index : -1;
      };
    } else {
      needle = q.toLowerCase();
      matcher = (line): number => line.toLowerCase().indexOf(needle);
    }
    const includeFilter = args.include ? parseInclude(args.include) : null;
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
        // 输出路径归一化为 posix 分隔符（Windows 下 relative 产出反斜杠，跨平台统一）
        const rel = relative(ctx.cwd, full).split(sep).join('/');
        // 文件名过滤：不匹配的文件跳过（含内容搜索也不做）
        if (includeFilter && !includeFilter(e.name)) continue;
        if (nameRe ? nameRe.test(e.name) : e.name.toLowerCase().includes(needle)) {
          hits.push(rel);
          continue;
        }
        try {
          const st = await stat(full);
          if (st.size > SEARCH_MAX_FILE_BYTES) continue;
          const text = await readFile(full, 'utf8');
          const lines = text.split('\n');
          let fileHits = 0;
          for (let i = 0; i < lines.length && hits.length < MAX_SEARCH_HITS && fileHits < MAX_HITS_PER_FILE; i++) {
            const idx = matcher(lines[i]!);
            if (idx >= 0) {
              fileHits++;
              const start = Math.max(0, idx - 30);
              const excerpt = lines[i]!.slice(start, idx + q.length + 60).trim();
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
  }
});
