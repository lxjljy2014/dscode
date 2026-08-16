import { DatabaseSync } from 'node:sqlite';
import type { IndexSearchHit, IndexStats } from '@dscode/shared';
import { collectTextFiles } from './diff';

/**
 * 代码索引库：扫描工作目录文本文件，建立「词 → 文件」倒排表并持久化（node:sqlite）。
 * 提供多词 AND 检索与统计，作为 agent search 工具的加速层。
 */

/** 词元化：按非字母数字切分 + camelCase 边界切分 + 小写 */
function tokenize(text: string): string[] {
  return text
    .split(/[^\p{L}\p{N}_]+/u)
    .flatMap(w => w.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/))
    .map(w => w.toLowerCase())
    .filter(Boolean);
}

const dbs = new Map<string, DatabaseSync>();

function getDb(file: string): DatabaseSync {
  let db = dbs.get(file);
  if (!db) {
    db = new DatabaseSync(file);
    db.exec('CREATE TABLE IF NOT EXISTS index_files (path TEXT PRIMARY KEY, words INTEGER NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS index_terms (term TEXT, path TEXT, count INTEGER, PRIMARY KEY (term, path))');
    db.exec('CREATE TABLE IF NOT EXISTS index_meta (key TEXT PRIMARY KEY, value TEXT)');
    dbs.set(file, db);
  }
  return db;
}

export function initIndex(file: string): void {
  getDb(file);
}

/** 重建索引：全量扫描 + 写倒排表（事务内） */
export async function buildIndex(cwd: string, file: string): Promise<IndexStats> {
  const db = getDb(file);
  const files = await collectTextFiles(cwd);
  db.exec('DELETE FROM index_files');
  db.exec('DELETE FROM index_terms');
  const insertFile = db.prepare('INSERT INTO index_files (path, words) VALUES (?, ?)');
  const insertTerm = db.prepare('INSERT INTO index_terms (term, path, count) VALUES (?, ?, ?)');
  const builtAt = Date.now();

  db.exec('BEGIN');
  try {
    for (const [path, content] of files) {
      const terms = tokenize(content);
      insertFile.run(path, terms.length);
      const counts = new Map<string, number>();
      for (const t of terms) counts.set(t, (counts.get(t) ?? 0) + 1);
      for (const [term, count] of counts) insertTerm.run(term, path, count);
    }
    db.prepare("INSERT INTO index_meta (key, value) VALUES ('built_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(builtAt));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  const termCount = (db.prepare('SELECT COUNT(*) AS c FROM index_terms').get() as { c: number }).c;
  return { fileCount: files.size, termCount, builtAt };
}

/** 多词 AND 检索：返回同时包含所有查询词的文件，按命中次数排序 */
export function searchIndex(file: string, query: string, limit = 50): IndexSearchHit[] {
  const db = getDb(file);
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) return [];
  const placeholders = terms.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT path, SUM(count) AS score FROM index_terms WHERE term IN (${placeholders}) GROUP BY path HAVING COUNT(DISTINCT term) = ? ORDER BY score DESC LIMIT ?`
    )
    .all(...terms, terms.length, limit) as unknown as Array<{ path: string; score: number }>;
  return rows.map(r => ({ path: r.path, score: r.score }));
}

export function indexStats(file: string): IndexStats {
  const db = getDb(file);
  const fileCount = (db.prepare('SELECT COUNT(*) AS c FROM index_files').get() as { c: number }).c;
  const termCount = (db.prepare('SELECT COUNT(*) AS c FROM index_terms').get() as { c: number }).c;
  const meta = db.prepare("SELECT value FROM index_meta WHERE key = 'built_at'").get() as { value: string } | undefined;
  return { fileCount, termCount, builtAt: meta ? Number(meta.value) : 0 };
}

/** 关闭指定数据文件的连接（测试清理/重建用；Windows 下不关闭连接会占用文件句柄导致目录删除失败） */
export function closeIndexDb(file: string): void {
  dbs.get(file)?.close();
  dbs.delete(file);
}

/** 关闭全部连接（应用退出/测试收尾） */
export function closeIndexDbs(): void {
  for (const db of dbs.values()) db.close();
  dbs.clear();
}