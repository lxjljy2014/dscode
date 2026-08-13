import { DatabaseSync } from 'node:sqlite';
import type { Message, Session } from '@dscode/shared';

/**
 * 会话持久化（node:sqlite 内置驱动，无原生依赖）。
 * 数据文件：userData/sessions.db，表 sessions / messages。
 * toolEvents 为瞬态展示数据，不落库。
 */

let db: DatabaseSync | null = null;

function getDb(file: string): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(file);
    db.exec(
      'CREATE TABLE IF NOT EXISTS sessions (' +
        'id TEXT PRIMARY KEY, ' +
        'title TEXT NOT NULL, ' +
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
  }
  return db;
}

export function initSessions(file: string): void {
  getDb(file);
}

interface SessionRow {
  id: string;
  title: string;
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
    .prepare('SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC')
    .all() as unknown as SessionRow[];
  const messages = getDb(file)
    .prepare('SELECT id, session_id, role, content, error_code, created_at FROM messages ORDER BY created_at ASC')
    .all() as unknown as MessageRow[];
  return rows.map(r => ({
    id: r.id,
    title: r.title,
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
      'INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at'
    )
    .run(session.id, session.title, session.createdAt, session.updatedAt);
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
