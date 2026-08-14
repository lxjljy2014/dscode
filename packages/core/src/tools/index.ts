import type { AgentToolName } from '@dscode/shared';
import { browseTool } from './browse';
export { fetchWebPage } from './browse';
import { editFileTool } from './edit-file';
import { listDirTool } from './list-dir';
import { readFileTool } from './read-file';
import { runCommandTool } from './run-command';
import { searchTool } from './search';
import { writeFileTool } from './write-file';
import type { Tool, ToolPermission, ToolResult } from './types';

/**
 * 工具注册表：新增工具在此登记一个 key，与 shared 的 AgentToolName 对齐由
 * `Record<AgentToolName, Tool>` 类型编译期保证（漏注册/多注册都会报错）。
 */
export const TOOLS: Record<AgentToolName, Tool> = {
  read_file: readFileTool,
  list_dir: listDirTool,
  search: searchTool,
  run_command: runCommandTool,
  write_file: writeFileTool,
  edit_file: editFileTool,
  browse: browseTool
};

/** 返回给模型的工具 schema 数组（OpenAI function calling 格式）；includeBrowse=false 时排除 browse */
export function toolSchemas(includeBrowse = true): unknown[] {
  return Object.values(TOOLS)
    .filter(t => (t.name === 'browse' ? includeBrowse : true))
    .map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }));
}

/** 工具权限分类（未知名默认按只读处理，与门控决策保持一致） */
export function toolPermission(name: AgentToolName): ToolPermission {
  return TOOLS[name]?.permission ?? 'read';
}

/** 统一执行入口：解析 JSON 参数 → 查表分发 → 异常兜底 */
export async function executeTool(name: string, argsJson: string, cwd: string): Promise<ToolResult> {
  const tool = TOOLS[name as AgentToolName];
  if (!tool) return { ok: false, error: `未知工具: ${name}` };
  let args: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(argsJson);
    args = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return { ok: false, error: '参数不是合法 JSON' };
  }
  try {
    return await tool.execute(args, { cwd });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
