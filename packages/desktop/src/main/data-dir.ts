import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { app } from 'electron';

/**
 * 应用自管理的数据目录（~/dscode）：按功能域拆分（参考 Claude Code / DSH），
 * 便于用户查找、备份与迁移；Electron/Chromium 内部数据留在 userData 不动。
 * 布局：
 *   ~/.dscode/config/    配置（按域拆分的 JSON，见 core persist/config.ts CONFIG_DOMAINS）
 *   ~/.dscode/sessions/  会话（JSONL：<workspace-slug>/<session-id>/{meta.json, session.jsonl}）
 *   ~/.dscode/db/        关系型数据统一一个库（dscode.db，按表组织：
 *                         usage_records / llm_cache_entries+stats / recent_projects / index_*）
 *   ~/.dscode/plugins/   用户插件
 */

const APP_DATA_DIR = '.dscode';
const CONFIG_DIR_NAME = 'config';
const DB_DIR_NAME = 'db';
const DB_FILE_NAME = 'dscode.db';

/** 合并库中各模块的表（与 core 模块 schema 一致） */
const LEGACY_DB_SOURCES: ReadonlyArray<{ file: string; tables: string[] }> = [
  { file: 'usage.db', tables: ['usage_records'] },
  { file: 'cache.db', tables: ['llm_cache_entries', 'llm_cache_stats'] },
  { file: 'projects.db', tables: ['recent_projects'] },
  { file: 'index.db', tables: ['index_files', 'index_terms', 'index_meta'] }
];

/** 应用根目录（~/.dscode），不存在时创建 */
export function getAppDataDir(): string {
  const dir = join(app.getPath('home'), APP_DATA_DIR);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 配置目录（~/.dscode/config），不存在时创建 */
export function getConfigDir(): string {
  const dir = join(getAppDataDir(), CONFIG_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 会话数据根目录（~/.dscode/sessions；JSONL 布局） */
export function getSessionsDir(): string {
  const dir = join(getAppDataDir(), 'sessions');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 合并数据库文件（~/.dscode/db/dscode.db），目录不存在时创建 */
export function getDbFile(): string {
  const dir = join(getAppDataDir(), DB_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  return join(dir, DB_FILE_NAME);
}

/** 插件目录（~/.dscode/plugins），不存在时创建 */
export function getPluginsDir(): string {
  const dir = join(getAppDataDir(), 'plugins');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 把 src 移动到 dst（目标已存在则跳过；失败静默，下次启动重试） */
function moveIfAbsent(src: string, dst: string): void {
  if (!existsSync(src) || existsSync(dst)) return;
  try {
    renameSync(src, dst);
  } catch {
    // 跨盘/占用失败：跳过，不阻塞启动
  }
}

/**
 * 把旧库数据合并进 dscode.db（幂等：INSERT OR REPLACE；成功后旧库改名 .bak）。
 * 表结构按旧库 sqlite_master 的 DDL 回放到目标库（缺失时），列结构来自同一套 core 模块，兼容。
 */
function mergeLegacyDb(dbDir: string, source: { file: string; tables: string[] }): void {
  const legacy = join(dbDir, source.file);
  const combined = join(dbDir, DB_FILE_NAME);
  if (!existsSync(legacy)) return;
  try {
    const dst = new DatabaseSync(combined);
    dst.prepare('ATTACH DATABASE ? AS legacy').run(legacy);
    for (const name of source.tables) {
      const ddl = dst.prepare("SELECT sql FROM legacy.sqlite_master WHERE type = 'table' AND name = ?").get(name) as
        | { sql?: string }
        | undefined;
      if (!ddl?.sql) continue;
      const exists = dst.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
      if (!exists) {
        // 原 DDL 形如 CREATE TABLE xxx (...)；转成 IF NOT EXISTS 幂等回放
        dst.exec(ddl.sql.replace(/^CREATE TABLE/i, 'CREATE TABLE IF NOT EXISTS'));
      }
      dst.prepare(`INSERT OR REPLACE INTO main.${name} SELECT * FROM legacy.${name}`).run();
    }
    dst.prepare('DETACH DATABASE legacy').run();
    dst.close();
    // 合并成功：旧库改名留底
    renameSync(legacy, legacy + '.bak');
  } catch {
    // 旧库损坏/合并失败：保留原文件，下次启动重试
  }
}

/**
 * 数据迁移（幂等，启动时在数据库/设置被打开之前调用）：
 * 1) 旧位置（userData/根目录/旧 db 目录/按域目录）的应用文件集中到 ~/.dscode
 * 2) sessions.db → sessions/（sessions.ts 负责 JSONL 化）
 * 3) usage/cache/projects/index 四个旧库 → 合并为一个 dscode.db
 * 4) settings.json → config/（单文件 → 拆分由 config.ts loadSettings 完成）
 * 5) 清理已废弃的空功能域目录
 */
export function migrateLegacyData(): void {
  const appRoot = getAppDataDir();
  const userData = app.getPath('userData');
  const oldDbDir = join(appRoot, 'db');
  const dbDir = join(appRoot, DB_DIR_NAME);

  // 1+2) 会话旧库 → sessions/（JSONL 迁移在 sessions.ts initSessions 中完成）
  moveIfAbsent(join(userData, 'sessions.db'), join(getSessionsDir(), 'sessions.db'));
  moveIfAbsent(join(appRoot, 'sessions.db'), join(getSessionsDir(), 'sessions.db'));
  moveIfAbsent(join(oldDbDir, 'sessions.db'), join(getSessionsDir(), 'sessions.db'));

  // 3) 四个旧库集中到 db/ 并合并为一个 dscode.db
  mkdirSync(dbDir, { recursive: true });
  for (const source of LEGACY_DB_SOURCES) {
    // 历史位置：userData（最早）→ ~/.dscode 根 → 旧 db/ 目录 → 按域目录（usage/cache/projects/index）
    for (const src of [
      join(userData, source.file),
      join(appRoot, source.file),
      join(oldDbDir, source.file),
      join(appRoot, 'usage', source.file),
      join(appRoot, 'cache', source.file),
      join(appRoot, 'projects', source.file),
      join(appRoot, 'index', source.file)
    ]) {
      moveIfAbsent(src, join(dbDir, source.file));
    }
    mergeLegacyDb(dbDir, source);
  }

  // 4) settings.json → config/
  const legacy = join(appRoot, 'settings.json');
  const legacyDst = join(getConfigDir(), 'settings.json');
  if (existsSync(legacy)) {
    if (!existsSync(join(getConfigDir(), 'general.json'))) {
      moveIfAbsent(legacy, legacyDst);
    } else {
      try {
        rmSync(legacy);
      } catch {
        // 删除失败（占用）忽略
      }
    }
  }
  moveIfAbsent(join(userData, 'settings.json'), legacyDst);

  // 插件目录
  moveIfAbsent(join(userData, 'plugins'), getPluginsDir());

  // 5) 清理已废弃的空功能域目录（usage/cache/projects/index 合并进 db 后）；db/ 与 sessions/ 是活跃目录保留
  for (const name of ['usage', 'cache', 'projects', 'index']) {
    const dir = join(appRoot, name);
    try {
      if (existsSync(dir) && readdirSync(dir).length === 0) rmSync(dir);
    } catch {
      // 删除失败忽略
    }
  }
}