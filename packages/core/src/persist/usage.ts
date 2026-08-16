import { DatabaseSync } from 'node:sqlite';
import type { UsageRecord } from '@dscode/shared';

/**
 * 使用统计持久化（node:sqlite）。
 * 数据文件：~/.dscode/usage.db，表 usage_records。agent 运行结束时追加一条用量记录。
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
        'created_at INTEGER NOT NULL, ' +
        'cached_prompt_tokens INTEGER NOT NULL DEFAULT 0, ' +
        'cache_tracked INTEGER NOT NULL DEFAULT 0)'
    );
    // 旧库迁移：缺列时逐一补列（CREATE TABLE IF NOT EXISTS 不会改已有表）；每次迁移独立判断
    const cols = db.prepare('PRAGMA table_info(usage_records)').all() as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'cached_prompt_tokens')) {
      db.exec('ALTER TABLE usage_records ADD COLUMN cached_prompt_tokens INTEGER NOT NULL DEFAULT 0');
    }
    if (!cols.some(c => c.name === 'cache_tracked')) {
      db.exec('ALTER TABLE usage_records ADD COLUMN cache_tracked INTEGER NOT NULL DEFAULT 0');
      // 回填：已有记录中确实带缓存命中数据的（cached>0）视为已统计；cached=0 的历史记录无法区分真实 0 命中与未统计，保持未跟踪
      db.exec('UPDATE usage_records SET cache_tracked = 1 WHERE cache_tracked = 0 AND cached_prompt_tokens > 0');
    }
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
      'INSERT INTO usage_records (session_id, model, prompt_tokens, completion_tokens, created_at, cached_prompt_tokens, cache_tracked) VALUES (?, ?, ?, ?, ?, ?, 1)'
    )
    .run(record.sessionId, record.model, record.promptTokens, record.completionTokens, record.createdAt, record.cachedPromptTokens ?? 0);
}

/** 用量记录（按时间倒序，最多 limit 条） */
export function listUsage(file: string, limit = 200): UsageRecord[] {
  const rows = getDb(file)
    .prepare(
      'SELECT id, session_id, model, prompt_tokens, completion_tokens, created_at, cached_prompt_tokens, cache_tracked FROM usage_records ORDER BY created_at DESC LIMIT ?'
    )
    .all(limit) as unknown as Array<{
    id: number;
    session_id: string;
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    created_at: number;
    cached_prompt_tokens: number;
    cache_tracked: number;
  }>;
  return rows.map(r => ({
    id: r.id,
    sessionId: r.session_id,
    model: r.model,
    promptTokens: r.prompt_tokens,
    completionTokens: r.completion_tokens,
    createdAt: r.created_at,
    cachedPromptTokens: r.cached_prompt_tokens,
    cacheTracked: r.cache_tracked === 1
  }));
}

/** 关闭指定数据文件的连接（测试清理/重建用；Windows 下不关闭连接会占用文件句柄导致目录删除失败） */
export function closeUsageDb(file: string): void {
  dbs.get(file)?.close();
  dbs.delete(file);
}

/** 关闭全部连接（应用退出/测试收尾） */
export function closeUsageDbs(): void {
  for (const db of dbs.values()) db.close();
  dbs.clear();
}