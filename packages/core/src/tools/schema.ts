/**
 * 工具 schema DSL（借鉴官方 harness tools/schema.ts 的 ValueSchemaSpec 设计，轻量版）：
 * 类型安全的参数声明 → 编译为 OpenAI function calling 的 parameters；InferArgs 提供参数类型推断。
 * 与 executeTool 的 validateArgs 配合：定义期类型安全 + 运行期统一校验。
 */

import type { AgentToolName } from '@dscode/shared';
import type { Tool, ToolContext, ToolPermission, ToolResult } from './types';

/** 字符串值 schema */
export interface StringSchema extends SchemaAnnotations {
  type: 'string';
  enum?: readonly string[];
}

/** 数字值 schema */
export interface NumberSchema extends SchemaAnnotations {
  type: 'number';
}

/** 整数值 schema */
export interface IntegerSchema extends SchemaAnnotations {
  type: 'integer';
}

/** 布尔值 schema */
export interface BooleanSchema extends SchemaAnnotations {
  type: 'boolean';
}

/** 数组 schema */
export interface ArraySchema extends SchemaAnnotations {
  type: 'array';
  items?: ValueSchema;
}

/** 对象 schema；properties 缺省表示任意 JSON 对象 */
export interface ObjectSchema extends SchemaAnnotations {
  type: 'object';
  properties?: ParameterSchema;
  additionalProperties?: boolean;
}

/** 任意 JSON 值（不校验结构） */
export interface JsonSchema extends SchemaAnnotations {
  type: 'json';
}

/** 全部 value schema 变体 */
export type ValueSchema =
  | StringSchema
  | NumberSchema
  | IntegerSchema
  | BooleanSchema
  | ArraySchema
  | ObjectSchema
  | JsonSchema;

/** schema 注解：描述（进模型 schema），其余仅文档 */
export interface SchemaAnnotations {
  /** 发给模型的字段描述 */
  description?: string;
  /** 非校验性默认值 */
  default?: unknown;
  /** 示例 */
  examples?: unknown[];
}

/** 参数属性：可标记 required（per-property 语义，编译时收集为 required 数组） */
export type ParameterProperty = ValueSchema & { required?: true };

/** 参数表：一个隐式开放对象根 */
export type ParameterSchema = {
  [key: string]: ParameterProperty;
  [key: symbol]: never;
};

// ---- 类型推断 ----

/** 推断单个 value schema 的 TS 类型 */
export type InferValue<S> =
  S extends { type: 'string'; enum: readonly (infer E)[] } ? E :
    S extends { type: 'string' } ? string :
      S extends { type: 'number' | 'integer' } ? number :
        S extends { type: 'boolean' } ? boolean :
          S extends { type: 'array'; items: infer I } ? InferValue<I>[] :
            S extends { type: 'array' } ? unknown[] :
              S extends { type: 'object'; properties: infer P } ? InferArgs<P & Record<string, ParameterProperty>> :
                S extends { type: 'object' } ? Record<string, unknown> :
                  S extends { type: 'json' } ? unknown :
                    never;

/** 推断参数表的 TS 类型：required 属性必填，其余可选 */
export type InferArgs<S extends object> = {
  [K in keyof S as S[K] extends { required: true } ? K : never]: InferValue<S[K]>;
} & {
  [K in keyof S as S[K] extends { required: true } ? never : K]?: InferValue<S[K]>;
};

// ---- 编译到 OpenAI function calling parameters ----

interface JsonSchemaNode {
  type?: string;
  description?: string;
  enum?: unknown[];
  items?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
}

/** 编译单个 value schema（运行时递归；schema 为作者声明，深度有限） */
function compileValueSchema(schema: ValueSchema): JsonSchemaNode | undefined {
  if (typeof schema !== 'object' || schema === null) return undefined;
  const node: JsonSchemaNode = {};
  if (schema.description !== undefined) node.description = schema.description;
  switch (schema.type) {
    case 'string':
      node.type = 'string';
      if (schema.enum !== undefined) node.enum = [...schema.enum];
      break;
    case 'number':
      node.type = 'number';
      break;
    case 'integer':
      node.type = 'integer';
      break;
    case 'boolean':
      node.type = 'boolean';
      break;
    case 'array':
      node.type = 'array';
      if (schema.items !== undefined) node.items = compileValueSchema(schema.items);
      break;
    case 'object':
      node.type = 'object';
      if (schema.properties !== undefined) {
        node.properties = {};
        const required: string[] = [];
        for (const [key, prop] of Object.entries(schema.properties)) {
          const compiled = compileValueSchema(prop);
          if (compiled !== undefined) node.properties[key] = compiled;
          if (prop.required === true) required.push(key);
        }
        if (required.length > 0) node.required = required;
      }
      if (schema.additionalProperties !== undefined) node.additionalProperties = schema.additionalProperties;
      break;
    case 'json':
      // 任意 JSON：不声明 type（宽松对象），仅带描述
      break;
    default:
      return undefined;
  }
  return node;
}

/** 编译参数表为 OpenAI function calling 的 parameters 对象 */
export function parameterSchemaToOpenAi(parameters: ParameterSchema): Tool['parameters'] {
  const compiled = compileValueSchema({ type: 'object', properties: parameters });
  return {
    type: 'object',
    properties: (compiled?.properties ?? {}) as Record<string, unknown>,
    ...(compiled?.required !== undefined ? { required: compiled.required } : {}),
  };
}

// ---- UI 呈现意图（借鉴官方 harness tools/presentation.ts 精简版） ----

/** 一次调用在 UI 中的呈现意图：pending（presentCall）与完成（presentResult）各有声明；缺省由 UI 兜底为通用卡 */
export type ToolCallView =
  | { card: 'generic'; title?: string }
  | { card: 'terminal'; title: string; cwd?: string }
  | { card: 'diff'; title: string; path: string; oldText: string | null; newText: string }
  | { card: 'file'; title: string; path: string; line?: number };

/** 完成态的呈现意图（复用 ToolContentBlock 作为结构化内容；title 可覆盖） */
export type ToolResultView = { card: 'generic'; title?: string } | { card: 'terminal'; title?: string } | { card: 'diff'; title?: string };

/**
 * 呈现意图是工具的 UI 渲染契约（纯函数，可重放）：presentCall 由 args 推导 pending 态，
 * presentResult 由 args+result 推导完成态。UI 按 card 分发渲染，新增工具无需改 UI。
 */
export interface ToolPresentation {
  /** pending 态呈现（可选；缺省 UI 用通用卡） */
  presentCall?(args: Record<string, unknown>): ToolCallView | undefined;
  /** 完成态呈现（可选；缺省 UI 用通用结果视图） */
  presentResult?(args: Record<string, unknown>, result: import('./types').ToolResult): ToolResultView | undefined;
}

/** 工具声明呈现意图的类型：Tool 接口可选携带 */
export interface ToolWithPresentation {
  presentation?: ToolPresentation;
}

// ---- defineTool 工厂 ----

export interface DefineToolOptions<S extends ParameterSchema> {
  /** 工具名（与 shared AgentToolName 对齐） */
  name: AgentToolName;
  /** 权限分类 */
  permission: ToolPermission;
  /** 发给模型的工具描述 */
  description: string;
  /** 参数 schema（类型安全的 DSL，编译为 OpenAI parameters） */
  parameters: S;
  /** 并发分类（缺省 exclusive） */
  concurrency?: Tool['concurrency'];
  /** 单次执行超时（毫秒） */
  timeoutMs?: number;
  /** 最后内容变换（可选）：管线 post 之后对结果做最终处理 */
  finalizeContent?(result: ToolResult): ToolResult | undefined;
  /** UI 呈现意图（可选）：presentCall/presentResult 声明卡片类型 */
  presentation?: ToolPresentation;
  /** 执行：args 为 InferArgs<S> 推断的类型（编译期校验） */
  execute(args: InferArgs<S>, ctx: ToolContext): ToolResult | Promise<ToolResult>;
}

/**
 * 定义工具（类型安全版本）：参数类型从 schema 推断，执行期入参类型正确；
 * 运行期由 executeTool 统一 validateArgs 校验（与手写 Tool 对象完全兼容）。
 */
export function defineTool<const S extends ParameterSchema>(options: DefineToolOptions<S>): Tool {
  return {
    name: options.name,
    permission: options.permission,
    description: options.description,
    parameters: parameterSchemaToOpenAi(options.parameters),
    ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.finalizeContent !== undefined ? { finalizeContent: options.finalizeContent } : {}),
    ...(options.presentation !== undefined ? { presentation: options.presentation } : {}),
    execute: options.execute as (args: Record<string, unknown>, ctx: ToolContext) => ToolResult | Promise<ToolResult>,
  };
}