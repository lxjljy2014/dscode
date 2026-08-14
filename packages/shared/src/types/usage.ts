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
