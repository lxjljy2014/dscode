/** 单次 agent 运行的 token 用量记录（持久化，供「使用统计」版块展示） */
export interface UsageRecord {
  /** 自增主键 */
  id: number;
  sessionId: string;
  model: string;
  promptTokens: number;
  /** API 前缀缓存命中的输入 token 数（DeepSeek 上下文缓存；旧数据缺省） */
  cachedPromptTokens?: number;
  /** 是否记录了缓存统计（false = 加缓存统计前的历史记录，不参与命中率计算） */
  cacheTracked?: boolean;
  completionTokens: number;
  createdAt: number;
}

/**
 * 会话级运行统计（输入卡片下方的统计条展示，仿 Claude Code）。
 * 按 sessionId 跨多次运行累计；每次运行结束时由运行时推送全量。
 */
export interface SessionStats {
  /** LLM 请求轮次累计（含缓存命中轮） */
  rounds: number;
  /** LLM 请求总耗时（毫秒） */
  llmMs: number;
  /** 工具调用总耗时（毫秒） */
  toolMs: number;
  /** 首 token 耗时累计（毫秒）与样本数（求平均用；缓存命中轮记 0） */
  firstTokenMsSum: number;
  firstTokenCount: number;
  /** 输入/输出 token 累计 */
  promptTokens: number;
  completionTokens: number;
  /** 缓存命中/未命中次数（该会话内，应用层完整请求缓存） */
  cacheHits: number;
  cacheMisses: number;
  /** 前缀缓存命中的 prompt token 数（API 侧 context caching；同一仓库连续工作时随前缀稳定而升高） */
  cacheHitTokens: number;
  /** 未命中缓存的 prompt token 数 */
  cacheMissTokens: number;
  /** 当前上下文占用（tokens）：最近一轮请求的完整 prompt 大小（含缓存命中；缓存命中轮沿用上轮值） */
  contextTokens?: number;
  /**
   * 当前上下文构成（估算 tokens，总和 ≈ contextTokens）：最近一轮请求里
   * 系统提示词 / 工具 schema / 对话消息 各自对上下文的占用，供 ContextMeter 菜单展示。
   */
  systemTokens?: number;
  toolsTokens?: number;
  messagesTokens?: number;
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