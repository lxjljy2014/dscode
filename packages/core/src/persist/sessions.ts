import { DatabaseSync } from 'node:sqlite';
import type { Message, Session } from '@dscode/shared';

/**
 * 会话持久化（node:sqlite 内置驱动，无原生依赖）。
 * 数据文件：userData/sessions.db，表 sessions / messages。
 * toolEvents 为瞬态展示数据，不落库。
 */

/** 按数据文件路径隔离连接（此前为模块级单例，file 参数在首次初始化后被忽略，复用多库会写错文件） */
const dbs = new Map<string, DatabaseSync>();

function getDb(file: string): DatabaseSync {
  let db = dbs.get(file);
  if (!db) {
    db = new DatabaseSync(file);
    db.exec(
      'CREATE TABLE IF NOT EXISTS sessions (' +
        'id TEXT PRIMARY KEY, ' +
        'title TEXT NOT NULL, ' +
        "working_directory TEXT NOT NULL DEFAULT '', " +
        'created_at INTEGER NOT NULL, ' +
        'updated_at INTEGER NOT NULL)'
    );
    db.exec(
      'CREATE TABLE IF NOT EXISTS messages (' +
        'id TEXT PRIMARY KEY, ' +
        'session_id TEXT NOT NULL, ' +
        'role TEXT NOT NULL, ' +
        'content TEXT NOT NULL, ' +
        'error_code TEXT, ' +
        'created_at INTEGER NOT NULL)'
    );
    // 旧库迁移：早期表结构没有 working_directory 列
    const cols = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'working_directory')) {
      db.exec("ALTER TABLE sessions ADD COLUMN working_directory TEXT NOT NULL DEFAULT ''");
    }
    dbs.set(file, db);
  }
  return db;
}

export function initSessions(file: string): void {
  getDb(file);
}

/** 把无工作空间归属的旧会话回填到当前工作目录（历史数据迁移） */
export function backfillSessions(file: string, workingDirectory: string): void {
  getDb(file).prepare("UPDATE sessions SET working_directory = ? WHERE working_directory = ''").run(workingDirectory);
}

interface SessionRow {
  id: string;
  title: string;
  working_directory: string;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  error_code: string | null;
  created_at: number;
}

/** 全部会话（按更新时间倒序，含消息，不持久化的 toolEvents 置空） */
export function listSessions(file: string): Session[] {
  const rows = getDb(file)
    .prepare('SELECT id, title, working_directory, created_at, updated_at FROM sessions ORDER BY updated_at DESC')
    .all() as unknown as SessionRow[];
  const messages = getDb(file)
    .prepare('SELECT id, session_id, role, content, error_code, created_at FROM messages ORDER BY created_at ASC')
    .all() as unknown as MessageRow[];
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    workingDirectory: r.working_directory,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    toolEvents: [],
    messages: messages
      .filter(m => m.session_id === r.id)
      .map(
        (m): Message => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.created_at,
          ...(m.error_code ? { errorCode: m.error_code } : {})
        })
      )
  }));
}

/** 新建/更新会话行 */
export function upsertSession(file: string, session: Session): void {
  getDb(file)
    .prepare(
      'INSERT INTO sessions (id, title, working_directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET title = excluded.title, working_directory = excluded.working_directory, updated_at = excluded.updated_at'
    )
    .run(session.id, session.title, session.workingDirectory, session.createdAt, session.updatedAt);
}

/** 追加一条消息（幂等：同 id 覆盖） */
export function upsertMessage(file: string, sessionId: string, message: Message): void {
  getDb(file)
    .prepare(
      'INSERT INTO messages (id, session_id, role, content, error_code, created_at) VALUES (?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET content = excluded.content, error_code = excluded.error_code'
    )
    .run(message.id, sessionId, message.role, message.content, message.errorCode ?? null, message.createdAt);
}
