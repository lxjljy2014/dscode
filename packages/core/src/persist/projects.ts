import { DatabaseSync } from 'node:sqlite';
import type { ProjectsListResult, RecentProject } from '@dscode/shared';

/**
 * 最近打开的工作空间（node:sqlite 内置驱动，无原生依赖）。
 * 数据文件：userData/projects.db，表 recent_projects。
 */

let db: DatabaseSync | null = null;

function getDb(file: string): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(file);
    db.exec(
      'CREATE TABLE IF NOT EXISTS recent_projects (' +
        'path TEXT PRIMARY KEY, ' +
        'name TEXT NOT NULL, ' +
        'last_opened_at INTEGER NOT NULL)'
    );
  }
  return db;
}

export function initProjects(file: string): void {
  getDb(file);
}

/** 最近项目列表（最多 10 条，按打开时间倒序） */
export function listProjects(file: string): RecentProject[] {
  const rows = getDb(file)
    .prepare('SELECT path, name, last_opened_at FROM recent_projects ORDER BY last_opened_at DESC LIMIT 10')
    .all() as Array<{ path: string; name: string; last_opened_at: number }>;
  return rows.map(r => ({ path: r.path, name: r.name, lastOpenedAt: r.last_opened_at }));
}

/** 记录/刷新一个打开过的项目 */
export function touchProject(file: string, path: string): void {
  const name = path.split(/[\\/]/).filter(Boolean).pop() || path;
  getDb(file)
    .prepare(
      'INSERT INTO recent_projects (path, name, last_opened_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(path) DO UPDATE SET name = excluded.name, last_opened_at = excluded.last_opened_at'
    )
    .run(path, name, Date.now());
}

export function listProjectsWithHome(file: string, homeDir: string): ProjectsListResult {
  return { projects: listProjects(file), homeDir };
}
