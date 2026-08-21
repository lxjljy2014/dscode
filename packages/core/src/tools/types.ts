import type { AnyToolName } from '@dscode/shared';

/**
 * 工具执行结果（统一判别联合，借鉴官方 harness 的 ToolExecutionResult 语义）。
 * - content：模型可见文本（role:'tool' 上下文与历史重建使用，保持逐字节稳定）
 * - changedPaths：本次实际变更的文件相对路径，供 diff 增量重算（run_command 无法追踪时缺省，退化为全量扫描）
 * - blocks：结构化内容块（UI 渲染用，与 content 并存，不进模型上下文）
 * - meta：工具私有展示元数据（如退出码），透传 UI 但不进模型上下文
 * - additionalContexts：附加给下一步的模型上下文（运行时注入为 user 消息）
 * - concludesTurn：标记本轮结束（执行完本批工具后不再回模型）
 */
export type ToolResult =
  | {
      ok: true;
      content: string;
      changedPaths?: string[];
      blocks?: import('@dscode/shared').ToolContentBlock[];
      meta?: Record<string, unknown>;
      additionalContexts?: string[];
      concludesTurn?: boolean;
    }
  | { ok: false; error: string; meta?: Record<string, unknown> };

/** 工具权限分类：决定门控策略（只读放行 / 写与执行按权限模式处理） */
export type ToolPermission = 'read' | 'write' | 'execute';

/** 工具并发分类：决定同一轮内多个工具调用的调度方式（借鉴官方 harness 的 isConcurrencySafe） */
export type ToolConcurrency = 'parallel' | 'exclusive';

/** 工具执行上下文（cwd 为工作目录，工具内所有相对路径的根；signal 为运行时 abort，超时/取消时中止） */
export interface ToolContext {
  cwd: string;
  /** 本次运行可用的技能列表（skill 工具按名查找；缺省空列表） */
  skills?: import('@dscode/shared').Skill[];
  /** 调用方取消信号：运行时停止/超时会中止，工具内的异步工作应响应它 */
  signal?: AbortSignal;
}

/**
 * 工具统一接口：发给模型的描述与实现一体，注册表驱动。
 * 新增工具 = 新建一个文件 + 在 tools/index.ts 注册一行；与 shared AgentToolName 的对齐由
 * `Record<AgentToolName, Tool>` 类型在编译期保证（漏注册/多注册都会报错）。
 */
export interface Tool {
  /** 工具名（内置工具与 shared AgentToolName 对齐；动态注入工具（MCP）用 mcp__<server>__<tool>） */
  name: AnyToolName;
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
  /**
   * 并发分类（缺省 exclusive）：
   * - parallel：可与同轮其它 parallel 工具并行执行（只读/无副作用优先声明）；
   *   并行组内按模型调用顺序提交结果，保证上下文顺序稳定。
   * - exclusive：单独执行，形成调度屏障（写/执行类默认）。
   */
  concurrency?: ToolConcurrency;
  /**
   * 单次执行超时（毫秒，可选）。超时以 AbortSignal 传给 execute 的 ctx.signal，
   * 由工具内的异步工作自行响应；工具未响应时结果按超时错误处理。
   */
  timeoutMs?: number;
  /**
   * 最后内容变换（可选）：对每次成功/失败结果做最终处理（如统一截断、注入审计信息），
   * 在管线 post 之后、结果返回之前执行；返回 undefined 保持原结果。
   */
  finalizeContent?(result: ToolResult): ToolResult | undefined;
  /**
   * UI 呈现意图（可选，借鉴官方 harness presentCall/presentResult）：纯函数声明
   * pending/完成态的卡片类型（generic/terminal/diff/file），UI 按 card 分发渲染。
   */
  presentation?: import('./schema').ToolPresentation;
  /** 执行：args 为已解析的参数对象；返回结果或错误 */
  execute(args: Record<string, unknown>, ctx: ToolContext): ToolResult | Promise<ToolResult>;
}

/** 工具并发分类：未声明的工具按独占处理（保守：只有显式声明 parallel 的才并行） */
export function toolConcurrency(tool: Pick<Tool, 'concurrency'>): ToolConcurrency {
  return tool.concurrency ?? 'exclusive';
}

/** 读取字符串参数：缺失或非字符串返回 null */
export function strArg(args: Record<string, unknown>, key: string): string | null {
  const v = args[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** 字符串参数 schema 片段（工具描述复用） */
export const STRING = { type: 'string' };

/** 参数校验结果：错误消息数组（空 = 合法）。校验规则来自工具 parameters schema（required + 基础类型）。 */
export function validateArgs(
  parameters: Tool['parameters'],
  args: Record<string, unknown>
): string[] {
  const violations: string[] = [];
  const required = parameters.required ?? [];
  for (const key of required) {
    if (args[key] === undefined || args[key] === null || args[key] === '') {
      violations.push('缺少参数 ' + key);
    }
  }
  for (const [key, value] of Object.entries(parameters.properties)) {
    if (value === undefined || typeof value !== 'object' || value === null) continue;
    const type = (value as { type?: unknown }).type;
    if (type === undefined || args[key] === undefined || args[key] === null) continue;
    // 仅校验基础标量类型；缺失已由 required 覆盖，复合类型由工具内部处理
    if (type === 'string' && typeof args[key] !== 'string') violations.push('参数 ' + key + ' 应为字符串');
    else if (type === 'number' && typeof args[key] !== 'number') violations.push('参数 ' + key + ' 应为数字');
    else if (type === 'boolean' && typeof args[key] !== 'boolean') violations.push('参数 ' + key + ' 应为布尔值');
  }
  return violations;
}