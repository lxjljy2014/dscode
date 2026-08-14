import type { AgentToolName } from '@dscode/shared';

/** 单轮流式请求累积的工具调用 */
export interface AccumulatedToolCall {
  index: number;
  id: string;
  name: AgentToolName;
  arguments: string;
}

/** 一轮请求的 token 用量（OpenAI 兼容 usage 字段） */
export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
}

/** 归一化流增量：各家格式统一映射为通用事件 */
export interface NormalizedDelta {
  /** 正文增量 */
  content?: string;
  /** 思维链增量（推理模型） */
  reasoning?: string;
  /**
   * 工具调用增量（按 index 累积）；index 缺失时用 -1 哨兵，
   * 由 stream 层按「当前已累积数量」兜底赋值。
   */
  toolCalls?: Array<{ index: number; id?: string; name?: string; arguments?: string }>;
  /** 流末尾携带的 usage（仅最后一帧出现） */
  usage?: ChatUsage;
}

/** 聊天请求输入（适配器据此构造 HTTP 请求） */
export interface ChatRequestInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: unknown[];
  /** 工具 schema 数组（调用方提供，适配器原样放入请求体） */
  tools: unknown[];
}

/** 构造完成的 HTTP 请求 */
export interface ChatRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * 模型适配器接口：一个供应商（或协议族）一份实现，注册表驱动。
 * 新增供应商 = 新建一个适配器文件 + 在 adapters/index.ts 注册一行，settings 里 provider.adapter 指定。
 */
export interface ModelAdapter {
  /** 适配器标识（provider.adapter 字段引用） */
  id: string;
  /** 构造聊天请求（端点拼接、请求体、认证头） */
  createChatRequest(input: ChatRequestInput): ChatRequest;
  /** 解析一行 SSE data：null = [DONE] 流结束；undefined = 无关块；否则归一化增量 */
  parseDelta(data: string): NormalizedDelta | null | undefined;
}
