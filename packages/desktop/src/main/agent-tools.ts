import { execFile } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import type { AgentToolName } from '@dscode/shared';

const execFileP = promisify(execFile);

/** agent 工具执行结果（统一判别联合） */
export type ToolResult = { ok: true; content: string } | { ok: false; error: string };

/** 工具权限分类：决定门控策略（只读放行 / 写与执行按权限模式处理） */
export type ToolPermission = 'read' | 'write' | 'execute';

// ---- 公共常量 ----

/** 遍历与搜索时跳过的目录 */
export const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist']);
const MAX_FILE_BYTES = 512 * 1024;
const MAX_OUTPUT_CHARS = 24 * 1024;
const MAX_DIR_ENTRIES = 200;
const MAX_SEARCH_HITS = 50;
const LIST_DEPTH = 2;
const COMMAND_TIMEOUT_MS = 60_000;
const SEARCH_MAX_FILE_BYTES = 256 * 1024;

/** 把工具传入的路径限定在工作目录内（防目录穿越），越界返回 null */
export function resolveSafePath(cwd: string, p: string): string | null {
  const resolved = join(cwd, p);
  const prefix = cwd.endsWith(sep) ? cwd : cwd + sep;
  if (resolved !== cwd && !resolved.startsWith(prefix)) return null;
  return resolved;
}

/** 截断超长输出并注明 */
function truncate(content: string, max = MAX_OUTPUT_CHARS): string {
  if (content.length <= max) return content;
  return `${content.slice(0, max)}\n……（输出过长，已截断）`;
}

// ---- 工具定义（OpenAI function schema） ----

interface ToolDefinition {
  name: AgentToolName;
  permission: ToolPermission;
  schema: {
    name: AgentToolName;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

const STRING = { type: 'string' };

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'read_file',
    permission: 'read',
    schema: {
      name: 'read_file',
      description: '读取工作目录内文件的内容（带行号）',
      parameters: {
        type: 'object',
        properties: { path: { ...STRING, description: '相对工作目录的文件路径' } },
        required: ['path']
      }
    }
  },
  {
    name: 'list_dir',
    permission: 'read',
    schema: {
      name: 'list_dir',
      description: '列出目录内容（递归两层，跳过 node_modules/.git/out/dist）',
      parameters: {
        type: 'object',
        properties: { path: { ...STRING, description: '相对工作目录的路径，默认根目录' } },
        required: []
      }
    }
  },
  {
    name: 'search',
    permission: 'read',
    schema: {
      name: 'search',
      description: '在工作目录内搜索文件名或文件内容（不区分大小写）',
      parameters: {
        type: 'object',
        properties: {
          query: { ...STRING, description: '搜索关键词' },
          path: { ...STRING, description: '相对工作目录的起始路径，默认根目录' }
        },
        required: ['query']
      }
    }
  },
  {
    name: 'run_command',
    permission: 'execute',
    schema: {
      name: 'run_command',
      description: '在工作目录内执行 shell 命令（最长 60 秒，返回输出与退出码）',
      parameters: {
        type: 'object',
        properties: { command: { ...STRING, description: '要执行的命令' } },
        required: ['command']
      }
    }
  },
  {
    name: 'write_file',
    permission: 'write',
    schema: {
      name: 'write_file',
      description: '创建或整体覆盖工作目录内的文件',
      parameters: {
        type: 'object',
        properties: {
          path: { ...STRING, description: '相对工作目录的文件路径' },
          content: { ...STRING, description: '完整文件内容' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    name: 'edit_file',
    permission: 'write',
    schema: {
      name: 'edit_file',
      description: '精确替换文件中唯一出现的一段内容（old_string 必须恰好匹配一次）',
      parameters: {
        type: 'object',
        properties: {
          path: { ...STRING, description: '相对工作目录的文件路径' },
          old_string: { ...STRING, description: '要被替换的原内容（需唯一匹配）' },
          new_string: { ...STRING, description: '替换后的新内容' }
        },
        required: ['path', 'old_string', 'new_string']
      }
    }
  }
];

export function toolPermission(name: AgentToolName): ToolPermission {
  return TOOL_DEFINITIONS.find(t => t.name === name)?.permission ?? 'read';
}

// ---- 参数解析 ----

function parseArgs(argsJson: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(argsJson);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function strArg(args: Record<string, unknown>, key: string): string | null {
  const v = args[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// ---- 只读工具 ----

function readFileTool(cwd: string, p: string): ToolResult {
  const target = resolveSafePath(cwd, p);
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

function listDirTool(cwd: string, p: string | null): ToolResult {
  const base = p ? resolveSafePath(cwd, p) : cwd;
  if (!base) return { ok: false, error: '路径不在工作目录内' };
  const lines: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > LIST_DEPTH || lines.length >= MAX_DIR_ENTRIES) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const dirs = entries.filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name)).sort((a, b) => a.name.localeCompare(b.name));
    const files = entries.filter(e => e.isFile()).sort((a, b) => a.name.localeCompare(b.name));
    for (const d of dirs) {
      lines.push(`${relative(cwd, join(dir, d.name))}/`);
      walk(join(dir, d.name), depth + 1);
    }
    for (const f of files) lines.push(relative(cwd, join(dir, f.name)));
  };
  walk(base, 0);
  const content = lines.length >= MAX_DIR_ENTRIES ? `${lines.join('\n')}\n……（条目过多，已截断）` : lines.join('\n');
  return { ok: true, content: content || '（空目录）' };
}

function searchTool(cwd: string, query: string, p: string | null): ToolResult {
  const base = p ? resolveSafePath(cwd, p) : cwd;
  if (!base) return { ok: false, error: '路径不在工作目录内' };
  const q = query.toLowerCase();
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
      const rel = relative(cwd, full);
      if (e.name.toLowerCase().includes(q)) {
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
          const idx = line.toLowerCase().indexOf(q);
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

// ---- 执行工具 ----

async function runCommandTool(cwd: string, command: string): Promise<ToolResult> {
  const shell = process.platform === 'win32' ? 'cmd.exe' : process.env.SHELL ?? '/bin/sh';
  const shellArg = process.platform === 'win32' ? '/c' : '-c';
  try {
    const { stdout, stderr } = await execFileP(shell, [shellArg, command], {
      cwd,
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true
    });
    const output = [stdout, stderr].filter(Boolean).join('\n');
    return { ok: true, content: truncate(output) || '（无输出）' };
  } catch (e) {
    // 超时（killed）或非零退出码：execFile 的 error 里带有 stdout/stderr/exit code，一并回给模型
    const err = e as { stdout?: string; stderr?: string; code?: number | string; killed?: boolean; message?: string };
    const output = [err.stdout, err.stderr].filter(Boolean).join('\n');
    const prefix = err.killed ? '命令超时（60s）已终止' : `命令失败（退出码 ${String(err.code)})`;
    return { ok: false, error: `${prefix}: ${truncate(output) || err.message || ''}` };
  }
}

// ---- 写工具 ----

function writeFileTool(cwd: string, p: string, content: string): ToolResult {
  if (content.length > MAX_FILE_BYTES) return { ok: false, error: '内容过大（>512KB）' };
  const target = resolveSafePath(cwd, p);
  if (!target) return { ok: false, error: '路径不在工作目录内' };
  // 目标不存在时要求父目录已存在，避免误写进错误层级
  const parent = join(target, '..');
  if (!existsSync(parent)) return { ok: false, error: '父目录不存在' };
  try {
    writeFileSync(target, content, 'utf8');
    return { ok: true, content: `已写入 ${relative(cwd, target)}（${content.length} 字符）` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function editFileTool(cwd: string, p: string, oldString: string, newString: string): ToolResult {
  const target = resolveSafePath(cwd, p);
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
    return { ok: true, content: `已替换 ${relative(cwd, target)} 中的 1 处匹配` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---- 统一入口 ----

export async function executeTool(name: string, argsJson: string, cwd: string): Promise<ToolResult> {
  const args = parseArgs(argsJson);
  switch (name as AgentToolName) {
    case 'read_file': {
      const p = strArg(args, 'path');
      return p ? readFileTool(cwd, p) : { ok: false, error: '缺少参数 path' };
    }
    case 'list_dir':
      return listDirTool(cwd, strArg(args, 'path'));
    case 'search': {
      const q = strArg(args, 'query');
      return q ? searchTool(cwd, q, strArg(args, 'path')) : { ok: false, error: '缺少参数 query' };
    }
    case 'run_command': {
      const command = strArg(args, 'command');
      return command ? runCommandTool(cwd, command) : { ok: false, error: '缺少参数 command' };
    }
    case 'write_file': {
      const p = strArg(args, 'path');
      const content = args['content'];
      if (!p) return { ok: false, error: '缺少参数 path' };
      if (typeof content !== 'string') return { ok: false, error: '缺少参数 content' };
      return writeFileTool(cwd, p, content);
    }
    case 'edit_file': {
      const p = strArg(args, 'path');
      const oldString = args['old_string'];
      const newString = args['new_string'];
      if (!p) return { ok: false, error: '缺少参数 path' };
      if (typeof oldString !== 'string' || typeof newString !== 'string') {
        return { ok: false, error: '缺少参数 old_string / new_string' };
      }
      return editFileTool(cwd, p, oldString, newString);
    }
    default:
      return { ok: false, error: `未知工具: ${name}` };
  }
}

/** 返回给模型的工具 schema 数组 */
export function toolSchemas(): unknown[] {
  return TOOL_DEFINITIONS.map(t => ({
    type: 'function',
    function: t.schema
  }));
}
