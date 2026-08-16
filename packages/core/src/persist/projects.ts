import { DatabaseSync } from 'node:sqlite';
import type { ProjectsListResult, RecentProject } from '@dscode/shared';

/**
 * 最近打开的工作空间（node:sqlite 内置驱动，无原生依赖）。
 * 数据文件：~/.dscode/projects.db，表 recent_projects。
 */

/** 按数据文件路径隔离连接（此前为模块级单例，file 参数在首次初始化后被忽略，复用多库会写错文件） */
const dbs = new Map<string, DatabaseSync>();

function getDb(file: string): DatabaseSync {
  let db = dbs.get(file);
  if (!db) {
    db = new DatabaseSync(file);
    db.exec(
      'CREATE TABLE IF NOT EXISTS recent_projects (' +
        'path TEXT PRIMARY KEY, ' +
        'name TEXT NOT NULL, ' +
        'last_opened_at INTEGER NOT NULL, ' +
        'removed_at INTEGER)'
    );
    // 旧库迁移：早期表结构没有 removed_at 列（缺省未移除）
    const cols = db.prepare('PRAGMA table_info(recent_projects)').all() as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'removed_at')) {
      db.exec('ALTER TABLE recent_projects ADD COLUMN removed_at INTEGER');
    }
    dbs.set(file, db);
  }
  return db;
}

export function initProjects(file: string): void {
  getDb(file);
}

/** 最近项目列表（最多 10 条，按打开时间倒序） */
export function listProjects(file: string): RecentProject[] {
  const rows = getDb(file)
    .prepare(
      'SELECT path, name, last_opened_at FROM recent_projects WHERE removed_at IS NULL ORDER BY last_opened_at DESC LIMIT 10'
    )
    .all() as Array<{ path: string; name: string; last_opened_at: number }>;
  return rows.map(r => ({ path: r.path, name: r.name, lastOpenedAt: r.last_opened_at }));
}

/** 记录/刷新一个打开过的项目 */
export function touchProject(file: string, path: string): void {
  const name = path.split(/[\\/]/).filter(Boolean).pop() || path;
  getDb(file)
    .prepare(
      'INSERT INTO recent_projects (path, name, last_opened_at, removed_at) VALUES (?, ?, ?, NULL) ' +
        'ON CONFLICT(path) DO UPDATE SET name = excluded.name, last_opened_at = excluded.last_opened_at, removed_at = NULL'
    )
    .run(path, name, Date.now());
}

/** 被「移除项目」移出的工作空间（渲染端据此把对应分组隐藏，任务数据保留） */
export function listRemovedProjects(file: string): RecentProject[] {
  const rows = getDb(file)
    .prepare(
      'SELECT path, name, last_opened_at FROM recent_projects WHERE removed_at IS NOT NULL ORDER BY removed_at DESC'
    )
    .all() as Array<{ path: string; name: string; last_opened_at: number }>;
  return rows.map(r => ({ path: r.path, name: r.name, lastOpenedAt: r.last_opened_at }));
}

/** 从侧边栏移除一个工作空间（仅隐藏分组，不删除任务；项目不在最近表时也补一行以记录移除状态） */
export function removeProject(file: string, path: string): void {
  const name = path.split(/[\\/]/).filter(Boolean).pop() || path;
  getDb(file)
    .prepare(
      'INSERT INTO recent_projects (path, name, last_opened_at, removed_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(path) DO UPDATE SET removed_at = excluded.removed_at'
    )
    .run(path, name, Date.now(), Date.now());
}

export function listProjectsWithHome(file: string, homeDir: string): ProjectsListResult {
  return { projects: listProjects(file), removed: listRemovedProjects(file), homeDir };
}

/** 关闭指定数据文件的连接（测试清理/重建用；Windows 下不关闭连接会占用文件句柄导致目录删除失败） */
export function closeProjectsDb(file: string): void {
  dbs.get(file)?.close();
  dbs.delete(file);
}

/** 关闭全部连接（应用退出/测试收尾） */
export function closeProjectsDbs(): void {
  for (const db of dbs.values()) db.close();
  dbs.clear();
}