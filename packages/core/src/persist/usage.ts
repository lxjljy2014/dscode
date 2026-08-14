import { DatabaseSync } from 'node:sqlite';
import type { UsageRecord } from '@dscode/shared';

/**
 * 使用统计持久化（node:sqlite）。
 * 数据文件：userData/usage.db，表 usage_records。agent 运行结束时追加一条用量记录。
 */

const dbs = new Map<string, DatabaseSync>();

function getDb(file: string): DatabaseSync {
  let db = dbs.get(file);
  if (!db) {
    db = new DatabaseSync(file);
    db.exec(
      'CREATE TABLE IF NOT EXISTS usage_records (' +
        'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
        'session_id TEXT NOT NULL, ' +
        'model TEXT NOT NULL, ' +
        'prompt_tokens INTEGER NOT NULL, ' +
        'completion_tokens INTEGER NOT NULL, ' +
        'created_at INTEGER NOT NULL)'
    );
    dbs.set(file, db);
  }
  return db;
}

export function initUsage(file: string): void {
  getDb(file);
}

/** 追加一条用量记录 */
export function recordUsage(file: string, record: Omit<UsageRecord, 'id'>): void {
  getDb(file)
    .prepare(
      'INSERT INTO usage_records (session_id, model, prompt_tokens, completion_tokens, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(record.sessionId, record.model, record.promptTokens, record.completionTokens, record.createdAt);
}

/** 用量记录（按时间倒序，最多 limit 条） */
export function listUsage(file: string, limit = 200): UsageRecord[] {
  const rows = getDb(file)
    .prepare(
      'SELECT id, session_id, model, prompt_tokens, completion_tokens, created_at FROM usage_records ORDER BY created_at DESC LIMIT ?'
    )
    .all(limit) as unknown as Array<{
    id: number;
    session_id: string;
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    created_at: number;
  }>;
  return rows.map(r => ({
    id: r.id,
    sessionId: r.session_id,
    model: r.model,
    promptTokens: r.prompt_tokens,
    completionTokens: r.completion_tokens,
    createdAt: r.created_at
  }));
}
