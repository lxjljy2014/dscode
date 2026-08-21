import type { AgentToolEvent, AgentToolName, Skill } from '@dscode/shared';
import { browseTool } from './browse';
export { fetchWebPage } from './browse';
import { editFileTool } from './edit-file';
import { listDirTool } from './list-dir';
import { readFileTool } from './read-file';
import { runCommandTool } from './run-command';
import { searchTool } from './search';
import { writeFileTool } from './write-file';
import { skillTool } from './skill';
import { runCodeTool } from '../code-run/run-code';
import { toolConcurrency, validateArgs } from './types';
import type { Tool, ToolContext, ToolPermission, ToolResult } from './types';
import { runToolPipeline } from './pipeline';
import type { ToolExecution } from './pipeline';

export type { Tool, ToolContext, ToolPermission, ToolResult } from './types';

export {
  defineTool,
  parameterSchemaToOpenAi,
  type ValueSchema,
  type ParameterSchema,
  type ParameterProperty,
  type InferArgs,
  type InferValue,
} from './schema';

export { skillCatalogSection } from './skill';
export { registerToolHooks, runToolPipeline, type ToolExecution, type ToolPipelineHooks } from './pipeline';

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
  browse: browseTool,
  run_code: runCodeTool,
  skill: skillTool
};

/** 工具名列表（与 AgentToolName 对齐，编译期由 Record<AgentToolName, Tool> 保证完整）；供跨进程校验单一事实源 */
export const TOOL_NAMES: readonly AgentToolName[] = Object.keys(TOOLS) as AgentToolName[];

/** 工具事件状态集合（与 shared AgentToolEvent['status'] 对齐）；供跨进程校验单一事实源 */
export const TOOL_STATUSES: readonly AgentToolEvent['status'][] = ['running', 'done', 'error', 'confirming', 'denied'];

/**
 * 返回给模型的工具 schema 数组（OpenAI function calling 格式）；includeBrowse=false 时排除 browse。
 * codeMode=true 时只暴露 run_code（Code Mode 折叠：模型只能调 run_code，程序内经 SDK 调其它工具），
 * includeSkill=false 时排除 skill（无可用技能时避免暴露必败工具），
 * extra 追加动态注入的工具（MCP 等，与内置注册表并行暴露），
 * 借鉴官方 harness 的 tools.mode='code' 设计。
 */
export function toolSchemas(includeBrowse = true, codeMode = false, includeSkill = true, extra?: readonly Tool[]): unknown[] {
  let tools: Tool[] = Object.values(TOOLS).filter(
    t => (t.name === 'browse' ? includeBrowse : true) && (t.name === 'skill' ? includeSkill : true)
  );
  if (codeMode) tools = tools.filter(t => t.name === 'run_code');
  if (extra && extra.length > 0) tools = tools.concat(extra);
  return tools.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }));
}

/** 工具权限分类（未知名默认按只读处理，与门控决策保持一致；含 MCP 等动态工具） */
export function toolPermission(name: string): ToolPermission {
  return TOOLS[name as AgentToolName]?.permission ?? 'read';
}

/** 工具并发分类（未知名默认独占） */
export function toolConcurrencyOf(name: string): 'parallel' | 'exclusive' {
  const tool = TOOLS[name as AgentToolName];
  return tool ? toolConcurrency(tool) : 'exclusive';
}

/**
 * 审批签名：写/编辑按路径、执行按命令、浏览按 URL（其余按首个字符串参数），
 * 会话记忆与持久规则均以该签名为匹配键（格式 ${tool}:${主参数}，是 UI 与运行时之间的契约）。
 */
export function approvalSignature(name: string, argsJson: string): string {
  let primary = '';
  try {
    const parsed = JSON.parse(argsJson) as Record<string, unknown>;
    const v = parsed['command'] ?? parsed['path'] ?? parsed['url'] ?? parsed['query'];
    if (typeof v === 'string') primary = v.trim();
    else if (v !== undefined && v !== null) primary = JSON.stringify(v).trim();
  } catch {
    // 参数非合法 JSON：签名退化为仅工具名
  }
  return name + ':' + primary;
}

/**
 * 统一执行入口：解析 JSON 参数 → schema 校验 → 执行管线（pre → guard → around(execute) → post → onResult）→ 异常兜底。
 * 参数校验失败与执行失败都返回结构化错误，供模型下次修正参数。
 * extraTools：动态注入工具（MCP）的查表（内置注册表未命中时回退到此）。
 */
export async function executeTool(
  name: string,
  argsJson: string,
  cwd: string,
  opts: { signal?: AbortSignal; skills?: Skill[]; extraTools?: Map<string, Tool> } = {}
): Promise<ToolResult> {
  const tool = TOOLS[name as AgentToolName] ?? opts.extraTools?.get(name);
  if (!tool) return { ok: false, error: '未知工具: ' + name };
  let args: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(argsJson);
    args = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return { ok: false, error: '参数不是合法 JSON' };
  }
  // 执行前统一参数校验（required + 基础类型），错误文案结构化，避免每个工具各自手写检查
  const violations = validateArgs(tool.parameters, args);
  if (violations.length > 0) return { ok: false, error: '参数错误: ' + violations.join('; ') };
  // 超时：工具声明 timeoutMs 时以 AbortSignal.timeout 与调用方 signal 合成；未声明则透传调用方 signal
  const ctx: ToolContext = { cwd, signal: opts.signal, skills: opts.skills };
  if (tool.timeoutMs !== undefined) {
    const timeoutSignal = AbortSignal.timeout(tool.timeoutMs);
    ctx.signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal;
  }
  const exec: ToolExecution = { name: name as AgentToolName, args, cwd, signal: ctx.signal };
  try {
    // 管线：pre/guard 拒绝短路；around 包裹工具本体；post 改写结果；onResult 观察
    const piped = await runToolPipeline(exec, async () => await tool.execute(args, ctx));
    // 工具级 finalizeContent：最后内容变换（管线 post 之后）
    if (tool.finalizeContent) {
      const finalized = tool.finalizeContent(piped);
      if (finalized !== undefined) return finalized;
    }
    return piped;
  } catch (e) {
    // 超时/中止：错误信息区分，避免误报为工具内部失败
    if (ctx.signal?.aborted) {
      return { ok: false, error: tool.timeoutMs !== undefined ? '工具执行超时' : '工具执行已中止' };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}