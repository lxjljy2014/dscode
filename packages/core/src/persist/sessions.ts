import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AgentToolEvent, AgentToolName, AssistantStep, Message, Session, SessionStats } from '@dscode/shared';

/**
 * 会话持久化（JSONL 文件，借鉴 Claude Code / DSH 的主流 harness 做法）：
 *   ~/.dscode/sessions/<workspace-slug>/<session-id>/
 *     meta.json       会话元数据（title/workingDirectory/时间/归档 —— 可变字段，原子重写）
 *     session.jsonl   消息日志（append-only；同 id 消息幂等重写）
 * 追加式日志天然适合会话这种「线性增长、按序读」的数据；每会话独立文件便于查看/备份/迁移。
 * 旧版 sqlite（sessions.db）首次 init 时自动迁移为 JSONL（读旧库 → 写文件 → 改名 .bak）。
 */

/** 工作目录 → 目录名 slug（非字母数字统一为 -，折叠连续 -） */
export function workspaceSlug(workingDirectory: string): string {
  const slug = workingDirectory.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'root';
}

/** 会话 id → 目录名（非法字符替换，保证可作目录名） */
function sessionDirName(sessionId: string): string {
  const name = sessionId.replace(/[^A-Za-z0-9._-]/g, '-');
  return name.length > 0 ? name : 'unknown';
}

interface SessionMeta {
  id: string;
  title: string;
  workingDirectory: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  stats?: SessionStats;
}

function sessionPath(rootDir: string, workingDirectory: string, sessionId: string): string {
  return join(rootDir, workspaceSlug(workingDirectory), sessionDirName(sessionId));
}

function metaFile(dir: string): string {
  return join(dir, 'meta.json');
}

function logFile(dir: string): string {
  return join(dir, 'session.jsonl');
}

/** 原子写 JSON（临时文件 + rename，避免半写状态） */
function writeJsonAtomic(file: string, obj: unknown): void {
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  renameSync(tmp, file);
}

/** 读取 meta（缺失/损坏返回 null） */
function readMeta(dir: string): SessionMeta | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(metaFile(dir), 'utf8'));
    if (typeof raw !== 'object' || raw === null) return null;
    const m = raw as Record<string, unknown>;
    if (typeof m['id'] !== 'string' || typeof m['title'] !== 'string') return null;
    return {
      id: m['id'],
      title: m['title'],
      workingDirectory: typeof m['workingDirectory'] === 'string' ? m['workingDirectory'] : '',
      createdAt: typeof m['createdAt'] === 'number' ? m['createdAt'] : 0,
      updatedAt: typeof m['updatedAt'] === 'number' ? m['updatedAt'] : 0,
      archived: m['archived'] === true,
      ...(typeof m['stats'] === 'object' && m['stats'] !== null ? { stats: m['stats'] as SessionStats } : {})
    };
  } catch {
    return null;
  }
}

/** 按 id 扫描会话目录（在哪个工作空间下不确定；找不到返回 null） */
function findSessionDir(rootDir: string, sessionId: string): string | null {
  const name = sessionDirName(sessionId);
  try {
    for (const ws of readdirSync(rootDir)) {
      const dir = join(rootDir, ws, name);
      if (existsSync(join(dir, 'meta.json')) || existsSync(join(dir, 'session.jsonl'))) return dir;
    }
  } catch {
    // 扫描失败（根目录不存在等）返回 null
  }
  return null;
}

/** 读取 session.jsonl 的非空行 */
function readLogLines(dir: string): string[] {
  try {
    if (!existsSync(logFile(dir))) return [];
    return readFileSync(logFile(dir), 'utf8').split('\n').filter(l => l.length > 0);
  } catch {
    return [];
  }
}

const TOOL_NAMES = new Set([
  'read_file', 'list_dir', 'search', 'run_command', 'write_file', 'edit_file', 'browse', 'run_code', 'skill'
]);

/** 读回时把 steps 归一化回有序步骤；非终态工具事件（崩溃时残留的 running/confirming）归一化为 error */
function parseSteps(steps: unknown): AssistantStep[] | undefined {
  if (steps === null || steps === undefined) return undefined;
  let parsed: unknown = steps;
  if (typeof steps === 'string') {
    try {
      parsed = JSON.parse(steps);
    } catch {
      return undefined;
    }
  }
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
}

/** 读回时把 stats 归一化回回复运行统计；字段缺失/损坏返回 undefined */
function parseStats(stats: unknown): Message['stats'] | undefined {
  if (stats === null || stats === undefined) return undefined;
  let parsed: unknown = stats;
  if (typeof stats === 'string') {
    try {
      parsed = JSON.parse(stats);
    } catch {
      return undefined;
    }
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const s = parsed as Record<string, unknown>;
  if (typeof s['startAt'] !== 'number' || typeof s['endAt'] !== 'number') return undefined;
  const result: Message['stats'] = { startAt: s['startAt'], endAt: s['endAt'] };
  if (typeof s['firstTokenMs'] === 'number') result.firstTokenMs = s['firstTokenMs'];
  if (typeof s['promptTokens'] === 'number') result.promptTokens = s['promptTokens'];
  if (typeof s['completionTokens'] === 'number') result.completionTokens = s['completionTokens'];
  return result;
}

/** 解析一行 JSONL 为消息（结构非法/损坏返回 null 跳过） */
function parseMessageLine(line: string): Message | null {
  try {
    const raw: unknown = JSON.parse(line);
    if (typeof raw !== 'object' || raw === null) return null;
    const m = raw as Record<string, unknown>;
    if (typeof m['id'] !== 'string' || (m['role'] !== 'user' && m['role'] !== 'assistant')) return null;
    if (typeof m['content'] !== 'string' || typeof m['createdAt'] !== 'number') return null;
    const msg: Message = { id: m['id'], role: m['role'], content: m['content'], createdAt: m['createdAt'] };
    if (typeof m['errorCode'] === 'string') msg.errorCode = m['errorCode'];
    const steps = parseSteps(m['steps']);
    if (steps !== undefined) msg.steps = steps;
    const stats = parseStats(m['stats']);
    if (stats !== undefined) msg.stats = stats;
    return msg;
  } catch {
    return null;
  }
}

/** 初始化会话根目录；旧版 sqlite sessions.db 存在时迁移为 JSONL */
export function initSessions(rootDir: string): void {
  mkdirSync(rootDir, { recursive: true });
  migrateSqliteSessions(rootDir);
}

// ---- 旧版 sqlite 迁移（读旧库 → 写 JSONL → 改名 .bak；幂等） ----

function migrateSqliteSessions(rootDir: string): void {
  const dbFile = join(rootDir, 'sessions.db');
  if (!existsSync(dbFile)) return;
  try {
    const db = new DatabaseSync(dbFile);
    // 旧表结构迁移（与历史 schema 演进一致）
    const cols = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'working_directory')) {
      db.exec("ALTER TABLE sessions ADD COLUMN working_directory TEXT NOT NULL DEFAULT ''");
    }
    if (!cols.some(c => c.name === 'archived')) {
      db.exec('ALTER TABLE sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
    }
    const msgCols = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>;
    if (!msgCols.some(c => c.name === 'steps')) {
      db.exec('ALTER TABLE messages ADD COLUMN steps TEXT');
    }
    if (!msgCols.some(c => c.name === 'stats')) {
      db.exec('ALTER TABLE messages ADD COLUMN stats TEXT');
    }
    const sessions = db
      .prepare('SELECT id, title, working_directory, created_at, updated_at, archived FROM sessions')
      .all() as Array<Record<string, unknown>>;
    const messages = db
      .prepare('SELECT id, session_id, role, content, error_code, steps, stats, created_at FROM messages')
      .all() as Array<Record<string, unknown>>;
    db.close();
    for (const s of sessions) {
      const id = String(s['id']);
      const dir = sessionPath(rootDir, String(s['working_directory'] ?? ''), id);
      mkdirSync(dir, { recursive: true });
      writeJsonAtomic(metaFile(dir), {
        id,
        title: String(s['title'] ?? ''),
        workingDirectory: String(s['working_directory'] ?? ''),
        createdAt: s['created_at'],
        updatedAt: s['updated_at'],
        archived: (s['archived'] ?? 0) === 1
      });
      const lines: string[] = [];
      for (const m of messages.filter(r => r['session_id'] === id)) {
        const obj: Record<string, unknown> = {
          id: m['id'],
          role: m['role'],
          content: m['content'],
          createdAt: m['created_at']
        };
        if (m['error_code']) obj['errorCode'] = m['error_code'];
        if (typeof m['steps'] === 'string' && m['steps'].length > 0) {
          try {
            obj['steps'] = JSON.parse(m['steps'] as string);
          } catch {
            // steps 损坏：跳过（读回走正文兜底）
          }
        }
        if (typeof m['stats'] === 'string' && m['stats'].length > 0) {
          try {
            obj['stats'] = JSON.parse(m['stats'] as string);
          } catch {
            // stats 损坏：跳过
          }
        }
        lines.push(JSON.stringify(obj));
      }
      writeFileSync(logFile(dir), lines.length > 0 ? lines.join('\n') + '\n' : '', 'utf8');
    }
    renameSync(dbFile, dbFile + '.bak');
  } catch {
    // 旧库损坏/读取失败：忽略（sessions.db 保留，下次启动重试）
  }
}

/** 全部会话（按更新时间倒序，含消息，不持久化的 toolEvents 置空） */
export function listSessions(rootDir: string): Session[] {
  const result: Session[] = [];
  let workspaces: string[] = [];
  try {
    workspaces = readdirSync(rootDir);
  } catch {
    return result;
  }
  for (const ws of workspaces) {
    let sessionDirs: string[] = [];
    try {
      sessionDirs = readdirSync(join(rootDir, ws));
    } catch {
      continue;
    }
    for (const name of sessionDirs) {
      const dir = join(rootDir, ws, name);
      const meta = readMeta(dir);
      if (!meta) continue;
      const messages: Message[] = [];
      for (const line of readLogLines(dir)) {
        const msg = parseMessageLine(line);
        if (msg) messages.push(msg);
      }
      result.push({
        id: meta.id,
        title: meta.title,
        workingDirectory: meta.workingDirectory,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        archived: meta.archived,
        ...(meta.stats ? { stats: meta.stats } : {}),
        toolEvents: [],
        messages
      });
    }
  }
  result.sort((a, b) => b.updatedAt - a.updatedAt);
  return result;
}

/** 新建/更新会话元数据（原子重写 meta.json；归档状态只在 setSessionArchived 中变更） */
export function upsertSession(rootDir: string, session: Session): void {
  mkdirSync(rootDir, { recursive: true });
  const dir = sessionPath(rootDir, session.workingDirectory, session.id);
  mkdirSync(dir, { recursive: true });
  // 归档状态只在 setSessionArchived 中变更：常规落库保留已有归档值（对齐 sqlite 版 ON CONFLICT 不覆盖 archived）
  const existing = readMeta(dir);
  const archived = existing ? existing.archived : session.archived === true;
  writeJsonAtomic(metaFile(dir), {
    id: session.id,
    title: session.title,
    workingDirectory: session.workingDirectory,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    archived,
    ...(session.stats ? { stats: session.stats } : {})
  });
}

/** 归档/恢复会话（同步刷新 updated_at，作为归档时间的排序依据） */
export function setSessionArchived(rootDir: string, sessionId: string, archived: boolean): void {
  const dir = findSessionDir(rootDir, sessionId);
  if (!dir) return;
  const meta = readMeta(dir);
  if (!meta) return;
  writeJsonAtomic(metaFile(dir), { ...meta, archived, updatedAt: Date.now() });
}

/** 追加一条消息（同 id 幂等：重写该行而非重复追加；消息日志保持 append-only 语义） */

/** 更新会话级运行统计（随 meta.json 持久化，重开会话后输入卡片下方统计条恢复展示） */
export function setSessionStats(rootDir: string, sessionId: string, stats: SessionStats): void {
  const dir = findSessionDir(rootDir, sessionId);
  if (!dir) return;
  const meta = readMeta(dir);
  if (!meta) return;
  writeJsonAtomic(metaFile(dir), { ...meta, stats });
}

/** 读取会话级运行统计（meta.json 里的 stats；会话不存在/损坏返回 undefined）。
 *  供宿主在重启后启动 agent 时把累计值（含上下文占用 contextTokens）作为起点回灌运行时，避免被清零。 */
export function getSessionStats(rootDir: string, sessionId: string): SessionStats | undefined {
  const dir = findSessionDir(rootDir, sessionId);
  if (!dir) return undefined;
  return readMeta(dir)?.stats;
}
export function upsertMessage(rootDir: string, sessionId: string, message: Message): void {
  const dir = findSessionDir(rootDir, sessionId);
  // 会话目录不存在（渲染端应先 persistSession 再 append）时静默跳过，避免孤儿文件
  if (!dir) return;
  const file = logFile(dir);
  const line = JSON.stringify({
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    ...(message.errorCode ? { errorCode: message.errorCode } : {}),
    ...(message.steps && message.steps.length > 0 ? { steps: message.steps } : {}),
    ...(message.stats ? { stats: message.stats } : {})
  });
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(l => l.length > 0) : [];
  const idx = lines.findIndex(l => {
    try {
      return (JSON.parse(l) as { id?: unknown }).id === message.id;
    } catch {
      return false;
    }
  });
  if (idx >= 0) {
    lines[idx] = line;
    writeFileSync(file, lines.join('\n') + '\n', 'utf8');
  } else {
    appendFileSync(file, line + '\n', 'utf8');
  }
}

/** 把无工作空间归属的旧会话回填到当前工作目录（并移入对应工作空间目录） */
export function backfillSessions(rootDir: string, workingDirectory: string): void {
  let workspaces: string[] = [];
  try {
    workspaces = readdirSync(rootDir);
  } catch {
    return;
  }
  for (const ws of workspaces) {
    if (ws === 'sessions.db' || ws.endsWith('.bak')) continue;
    let sessionDirs: string[] = [];
    try {
      sessionDirs = readdirSync(join(rootDir, ws));
    } catch {
      continue;
    }
    for (const name of sessionDirs) {
      const dir = join(rootDir, ws, name);
      const meta = readMeta(dir);
      if (!meta || meta.workingDirectory) continue;
      const target = sessionPath(rootDir, workingDirectory, meta.id);
      try {
        if (target !== dir) {
          mkdirSync(join(rootDir, workspaceSlug(workingDirectory)), { recursive: true });
          renameSync(dir, target);
        }
        writeJsonAtomic(metaFile(target), { ...meta, workingDirectory });
      } catch {
        // 迁移失败（占用等）忽略，下次启动重试
      }
    }
  }
}