import type { AgentToolName } from '@dscode/shared';

/** 工具执行结果（统一判别联合）。changedPaths 为本次实际变更的文件相对路径，供 diff 增量重算（run_command 无法追踪时缺省，退化为全量扫描）。 */
export type ToolResult = { ok: true; content: string; changedPaths?: string[] } | { ok: false; error: string };

/** 工具权限分类：决定门控策略（只读放行 / 写与执行按权限模式处理） */
export type ToolPermission = 'read' | 'write' | 'execute';

/** 工具执行上下文（cwd 为工作目录，工具内所有相对路径的根） */
export interface ToolContext {
  cwd: string;
}

/**
 * 工具统一接口：发给模型的描述与实现一体，注册表驱动。
 * 新增工具 = 新建一个文件 + 在 tools/index.ts 注册一行；与 shared AgentToolName 的对齐由
 * `Record<AgentToolName, Tool>` 类型在编译期保证（漏注册/多注册都会报错）。
 */
export interface Tool {
  /** 工具名（与 shared AgentToolName 对齐） */
  name: AgentToolName;
  /** 权限分类 */
  permission: ToolPermission;
  /** 发给模型的工具描述 */
  description: string;
  /** 参数 schema（OpenAI function calling 的 parameters 部分） */
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** 执行：args 为已解析的参数对象；返回结果或错误 */
  execute(args: Record<string, unknown>, ctx: ToolContext): ToolResult | Promise<ToolResult>;
}

/** 读取字符串参数：缺失或非字符串返回 null */
export function strArg(args: Record<string, unknown>, key: string): string | null {
  const v = args[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** 字符串参数 schema 片段（工具描述复用） */
export const STRING = { type: 'string' };
