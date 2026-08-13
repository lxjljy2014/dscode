/** git 分支列表结果 */
export type GitListResult = { ok: true; current: string; branches: string[] } | { ok: false; error: string };

/** git 操作结果（checkout / create-branch） */
export type GitOpResult = { ok: true } | { ok: false; error: string };

/** git log --graph 解析出的一行提交图谱 */
export interface GitGraphRow {
  /** 图谱前缀（ASCII 线条，可能为空串 = 纯线条对齐行） */
  graph: string;
  /** %h 短提交 id */
  hash: string;
  /** %an 作者 */
  author: string;
  /** %ad --date=short 日期 */
  date: string;
  /** %s 提交主题 */
  subject: string;
}

export type GitGraphResult = { ok: true; graph: GitGraphRow[] } | { ok: false; error: string };
