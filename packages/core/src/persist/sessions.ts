import { DatabaseSync } from 'node:sqlite';
import type { AgentToolEvent, AgentToolName, AssistantStep, Message, Session } from '@dscode/shared';

/**
 * 会话持久化（node:sqlite 内置驱动，无原生依赖）。
 * 数据文件：userData/sessions.db，表 sessions / messages。
 * 消息的 steps（思维链/正文/工具调用交错的有序步骤）以 JSON 存 messages.steps 列；
 * 会话级 toolEvents 仍为瞬态展示数据，不落库。
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
        'updated_at INTEGER NOT NULL, ' +
        'archived INTEGER NOT NULL DEFAULT 0)'
    );
    db.exec(
      'CREATE TABLE IF NOT EXISTS messages (' +
        'id TEXT PRIMARY KEY, ' +
        'session_id TEXT NOT NULL, ' +
        'role TEXT NOT NULL, ' +
        'content TEXT NOT NULL, ' +
        'error_code TEXT, ' +
        'steps TEXT, ' +
        'stats TEXT, ' +
        'created_at INTEGER NOT NULL)'
    );
    // 旧库迁移：早期表结构没有 working_directory 列
    const cols = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'working_directory')) {
      db.exec("ALTER TABLE sessions ADD COLUMN working_directory TEXT NOT NULL DEFAULT ''");
    }
    // 旧库迁移：早期表结构没有 archived 列（缺省未归档）
    if (!cols.some(c => c.name === 'archived')) {
      db.exec('ALTER TABLE sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
    }
    // 旧库迁移：早期表结构没有 steps 列（steps 为 NULL 时渲染端走正文兜底）
    const msgCols = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>;
    if (!msgCols.some(c => c.name === 'steps')) {
      db.exec('ALTER TABLE messages ADD COLUMN steps TEXT');
    }
    // 旧库迁移：早期表结构没有 stats 列（回复运行统计，缺失时渲染端不展示）
    if (!msgCols.some(c => c.name === 'stats')) {
      db.exec('ALTER TABLE messages ADD COLUMN stats TEXT');
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
  archived: number;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  error_code: string | null;
  steps: string | null;
  stats: string | null;
  created_at: number;
}

const TOOL_NAMES = new Set(['read_file', 'list_dir', 'search', 'run_command', 'write_file', 'edit_file', 'browse']);

/** 读库时把 steps JSON 反序列化回有序步骤；非终态工具事件（崩溃时落库的 running/confirming）归一化为 error */
function parseSteps(steps: string | null): AssistantStep[] | undefined {
  if (steps === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(steps);
    if (!Array.isArray(parsed)) return undefined;
    const result: AssistantStep[] = [];
    for (const s of parsed) {
      if (typeof s !== 'object' || s === null) continue;
      const step = s as Record<string, unknown>;
      if (step['kind'] === 'reasoning' || step['kind'] === 'text') {
        if (typeof step['content'] === 'string') result.push({ kind: step['kind'], content: step['content'] });
        continue;
      }
      if (step['kind'] !== 'tool' || typeof step['event'] !== 'object' || step['event'] === null) continue;
      const e = step['event'] as Record<string, unknown>;
      if (
        typeof e['id'] !== 'string' ||
        typeof e['name'] !== 'string' ||
        !TOOL_NAMES.has(e['name']) ||
        typeof e['args'] !== 'string' ||
        typeof e['createdAt'] !== 'number'
      ) {
        continue;
      }
      // 非终态（崩溃残留的 running/confirming）归一化为 error
      const status: AgentToolEvent['status'] =
        e['status'] === 'done' || e['status'] === 'error' || e['status'] === 'denied' ? e['status'] : 'error';
      const interrupted = status === 'error' && e['status'] !== 'error';
      let error: string | undefined = typeof e['error'] === 'string' ? e['error'] : undefined;
      if (interrupted && error === undefined) error = '会话中断，工具未完成';
      result.push({
        kind: 'tool',
        event: {
          id: e['id'],
          name: e['name'] as AgentToolName,
          args: e['args'],
          status,
          createdAt: e['createdAt'],
          ...(typeof e['summary'] === 'string' ? { summary: e['summary'] } : {}),
          ...(error !== undefined ? { error } : {})
        }
      });
    }
    return result.length > 0 ? result : undefined;
  } catch {
    // steps JSON 损坏时走正文兜底
    return undefined;
  }
}

/** 读库时把 stats JSON 反序列化回回复运行统计；字段缺失/损坏时返回 undefined */
function parseStats(stats: string | null): Message['stats'] | undefined {
  if (stats === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(stats);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const s = parsed as Record<string, unknown>;
    if (typeof s['startAt'] !== 'number' || typeof s['endAt'] !== 'number') return undefined;
    const result: Message['stats'] = { startAt: s['startAt'], endAt: s['endAt'] };
    if (typeof s['firstTokenMs'] === 'number') result.firstTokenMs = s['firstTokenMs'];
    if (typeof s['promptTokens'] === 'number') result.promptTokens = s['promptTokens'];
    if (typeof s['completionTokens'] === 'number') result.completionTokens = s['completionTokens'];
    return result;
  } catch {
    return undefined;
  }
}

/** 全部会话（按更新时间倒序，含消息，不持久化的 toolEvents 置空） */
export function listSessions(file: string): Session[] {
  const rows = getDb(file)
    .prepare('SELECT id, title, working_directory, created_at, updated_at, archived FROM sessions ORDER BY updated_at DESC')
    .all() as unknown as SessionRow[];
  const messages = getDb(file)
    .prepare(
      'SELECT id, session_id, role, content, error_code, steps, stats, created_at FROM messages ORDER BY created_at ASC'
    )
    .all() as unknown as MessageRow[];
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    workingDirectory: r.working_directory,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archived: r.archived === 1,
    toolEvents: [],
    messages: messages
      .filter(m => m.session_id === r.id)
      .map((m): Message => {
        const steps = parseSteps(m.steps);
        const stats = parseStats(m.stats);
        return {
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.created_at,
          ...(m.error_code ? { errorCode: m.error_code } : {}),
          ...(steps !== undefined ? { steps } : {}),
          ...(stats !== undefined ? { stats } : {})
        };
      })
  }));
}

/** 新建/更新会话行（归档状态只在 setSessionArchived 中变更，此处冲突更新不覆盖 archived） */
export function upsertSession(file: string, session: Session): void {
  getDb(file)
    .prepare(
      'INSERT INTO sessions (id, title, working_directory, created_at, updated_at, archived) VALUES (?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET title = excluded.title, working_directory = excluded.working_directory, updated_at = excluded.updated_at'
    )
    .run(
      session.id,
      session.title,
      session.workingDirectory,
      session.createdAt,
      session.updatedAt,
      session.archived ? 1 : 0
    );
}

/** 归档/恢复会话（同步刷新 updated_at，作为归档时间的排序依据） */
export function setSessionArchived(file: string, sessionId: string, archived: boolean): void {
  getDb(file)
    .prepare('UPDATE sessions SET archived = ?, updated_at = ? WHERE id = ?')
    .run(archived ? 1 : 0, Date.now(), sessionId);
}

/** 追加一条消息（幂等：同 id 覆盖；steps 随消息以 JSON 落库） */
export function upsertMessage(file: string, sessionId: string, message: Message): void {
  getDb(file)
    .prepare(
      'INSERT INTO messages (id, session_id, role, content, error_code, steps, stats, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET content = excluded.content, error_code = excluded.error_code, steps = excluded.steps, stats = excluded.stats'
    )
    .run(
      message.id,
      sessionId,
      message.role,
      message.content,
      message.errorCode ?? null,
      message.steps && message.steps.length > 0 ? JSON.stringify(message.steps) : null,
      message.stats ? JSON.stringify(message.stats) : null,
      message.createdAt
    );
}
