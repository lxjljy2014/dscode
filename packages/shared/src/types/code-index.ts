/** 代码索引统计 */
export interface IndexStats {
  fileCount: number;
  termCount: number;
  builtAt: number;
}

/** 索引检索命中 */
export interface IndexSearchHit {
  path: string;
  score: number;
}
