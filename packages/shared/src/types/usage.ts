/** 单次 agent 运行的 token 用量记录（持久化，供「使用统计」版块展示） */
export interface UsageRecord {
  /** 自增主键 */
  id: number;
  sessionId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  createdAt: number;
}

/** LLM 回复缓存统计（使用统计版块展示命中率与节省量） */
export interface LlmCacheStats {
  /** 缓存命中请求数 */
  hits: number;
  /** 未命中请求数 */
  misses: number;
  /** 命中率 0..1（hits / (hits + misses)，无请求时为 0） */
  hitRate: number;
  /** 命中省下的输入 token 数（按缓存记录计） */
  savedPromptTokens: number;
  /** 命中省下的输出 token 数 */
  savedCompletionTokens: number;
  /** 当前缓存条目数 */
  entries: number;
}
