import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import type { SettingsPatch } from '@dscode/shared';
import {
  backfillSessions,
  buildIndex,
  checkout,
  createBranch,
  fetchWebPage,
  getPlugins,
  graph,
  indexStats,
  initIndex,
  initProjects,
  initSessions,
  initUsage,
  listBranches,
  listMcpTools,
  listProjectsWithHome,
  listSessions,
  listUsage,
  readWorkspaceFile,
  removeProject,
  scanTree,
  searchIndex,
  setSessionArchived,
  touchProject,
  upsertMessage,
  upsertSession,
  verifyProvider
} from '@dscode/core';
import { resolveConfirm, startAgent, stopAgent } from './agent/agent';
import { loadAppSettings, saveAppSettings } from './settings';
import { ensureTerminal, killTerminal, resizeTerminal, writeTerminal } from './shell/terminal';
import { isMessage, isSession, isString, parseTerminalSize } from './validators';

/**
 * 业务 IPC 注册（ipcMain.handle / ipcRenderer.invoke；终端输入/尺寸为 ipcMain.on 单向通道）。
 * 每个 handler 校验 sender 属于主窗口、参数类型合法后再执行；
 * 参数 schema 统一收窄见 ./validators.ts，结果统一为 { ok } 判别联合或 null（取消选择）。
 */

function withMainWindow<E extends Electron.IpcMainEvent | Electron.IpcMainInvokeEvent>(
  handler: (win: BrowserWindow, ...args: unknown[]) => unknown
): (e: E, ...args: unknown[]) => unknown {
  return (e, ...args) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return undefined;
    return handler(win, ...args);
  };
}

export function registerIpcHandlers(): void {
  const settingsFile = app.getPath('userData') + '/settings.json';
  const projectsFile = app.getPath('userData') + '/projects.db';
  const sessionsFile = app.getPath('userData') + '/sessions.db';
  const usageFile = app.getPath('userData') + '/usage.db';
  const pluginsDir = app.getPath('userData') + '/plugins';
  const indexFile = app.getPath('userData') + '/index.db';
  const homeDir = app.getPath('home');
  initProjects(projectsFile);
  initSessions(sessionsFile);
  initUsage(usageFile);
  initIndex(indexFile);
  // 旧数据迁移：无工作空间归属的会话回填到当前工作目录
  backfillSessions(sessionsFile, loadAppSettings(settingsFile, homeDir).workingDirectory);

  // ---- settings ----
  ipcMain.handle(
    'settings:get',
    withMainWindow(() => loadAppSettings(settingsFile, homeDir))
  );

  ipcMain.handle(
    'settings:set',
    withMainWindow((_win, patch: unknown) => {
      if (typeof patch !== 'object' || patch === null) return loadAppSettings(settingsFile, homeDir);
      const record = patch as Record<string, unknown>;
      const next = saveAppSettings(settingsFile, homeDir, record as SettingsPatch);
      // 工作目录变化且不是家目录 → 记入最近项目
      if (typeof record['workingDirectory'] === 'string' && record['workingDirectory'] !== homeDir) {
        touchProject(projectsFile, record['workingDirectory'] as string);
      }
      return next;
    })
  );

  // ---- 最近项目 ----
  ipcMain.handle(
    'projects:list',
    withMainWindow(() => listProjectsWithHome(projectsFile, homeDir))
  );
  ipcMain.handle(
    'projects:remove',
    withMainWindow((_win, path: unknown) => {
      if (!isString(path)) return { ok: false as const, error: 'invalid path' };
      removeProject(projectsFile, path);
      return { ok: true as const };
    })
  );

  // ---- 目录选择 ----
  ipcMain.handle(
    'dialog:pick-directory',
    withMainWindow(async win => {
      const result = await dialog.showOpenDialog(win, {
        title: 'Select working directory',
        properties: ['openDirectory', 'createDirectory']
      });
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
    })
  );

  // ---- 供应商校验 ----
  ipcMain.handle(
    'provider:verify',
    withMainWindow((_win, baseUrl: unknown, apiKey: unknown) => verifyProvider(baseUrl, apiKey))
  );

  // ---- 使用统计 ----
  ipcMain.handle(
    'usage:list',
    withMainWindow(() => listUsage(usageFile))
  );

  // ---- MCP ----
  ipcMain.handle(
    'mcp:list-tools',
    withMainWindow(async (_win, command: unknown, args: unknown) => {
      if (!isString(command) || !Array.isArray(args) || !args.every(isString)) {
        return { ok: false as const, error: 'invalid args' };
      }
      try {
        const tools = await listMcpTools({ command, args: args as string[] });
        return { ok: true as const, tools };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
      }
    })
  );

  // ---- 插件 ----
  ipcMain.handle(
    'plugins:list',
    withMainWindow(() => getPlugins(pluginsDir))
  );

  // ---- 代码索引 ----
  ipcMain.handle('index:stats', withMainWindow(() => indexStats(indexFile)));
  ipcMain.handle(
    'index:build',
    withMainWindow(() => buildIndex(loadAppSettings(settingsFile, homeDir).workingDirectory, indexFile))
  );
  ipcMain.handle(
    'index:search',
    withMainWindow((_win, query: unknown) => (isString(query) ? searchIndex(indexFile, query) : []))
  );

  // ---- 浏览器（测试抓取） ----
  ipcMain.handle(
    'browser:fetch',
    withMainWindow(async (_win, url: unknown) => {
      if (!isString(url)) return { ok: false as const, error: 'invalid url' };
      try {
        return { ok: true as const, content: await fetchWebPage(url) };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
      }
    })
  );

  // ---- agent ----
  ipcMain.handle(
    'agent:start',
    withMainWindow((win, sessionId: unknown, model: unknown, messages: unknown, subagentId: unknown) =>
      isString(sessionId)
        ? startAgent(win, sessionId, model, messages, subagentId)
        : { ok: false, error: 'invalid-args' as const }
    )
  );
  ipcMain.handle(
    'agent:stop',
    withMainWindow((win, sessionId: unknown) => {
      if (isString(sessionId)) stopAgent(win, sessionId);
    })
  );
  ipcMain.handle(
    'agent:confirm-response',
    withMainWindow((_win, toolEventId: unknown, approve: unknown) => resolveConfirm(toolEventId, approve))
  );

  // ---- 工作区（异步扫描/读取，避免阻塞主进程） ----
  ipcMain.handle(
    'workspace:tree',
    withMainWindow(async () => scanTree(loadAppSettings(settingsFile, homeDir).workingDirectory))
  );
  ipcMain.handle(
    'workspace:read-file',
    withMainWindow(async (_win, relPath: unknown) => {
      const cwd = loadAppSettings(settingsFile, homeDir).workingDirectory;
      return isString(relPath) ? readWorkspaceFile(cwd, relPath) : { ok: false, error: 'invalid path' };
    })
  );

  // ---- 会话持久化 ----
  ipcMain.handle(
    'sessions:list',
    withMainWindow(() => listSessions(sessionsFile))
  );
  ipcMain.handle(
    'sessions:create',
    withMainWindow((_win, session: unknown) => {
      if (!isSession(session)) return { ok: false, error: 'invalid session' };
      upsertSession(sessionsFile, session);
      return { ok: true };
    })
  );
  ipcMain.handle(
    'sessions:append',
    withMainWindow((_win, sessionId: unknown, message: unknown) => {
      if (!isString(sessionId) || !isMessage(message)) return { ok: false, error: 'invalid args' };
      upsertMessage(sessionsFile, sessionId, message);
      return { ok: true };
    })
  );
  ipcMain.handle(
    'sessions:archive',
    withMainWindow((_win, sessionId: unknown, archived: unknown) => {
      if (!isString(sessionId) || typeof archived !== 'boolean') return { ok: false, error: 'invalid args' };
      setSessionArchived(sessionsFile, sessionId, archived);
      return { ok: true };
    })
  );

  // ---- git ----
  ipcMain.handle(
    'git:list-branches',
    withMainWindow((_win, cwd: unknown) => (isString(cwd) ? listBranches(cwd) : { ok: false, error: 'invalid cwd' }))
  );
  ipcMain.handle(
    'git:checkout',
    withMainWindow((_win, cwd: unknown, branch: unknown) =>
      isString(cwd) && isString(branch) ? checkout(cwd, branch) : { ok: false, error: 'invalid args' }
    )
  );
  ipcMain.handle(
    'git:create-branch',
    withMainWindow((_win, cwd: unknown, name: unknown) =>
      isString(cwd) && isString(name) ? createBranch(cwd, name) : { ok: false, error: 'invalid args' }
    )
  );
  ipcMain.handle(
    'git:graph',
    withMainWindow((_win, cwd: unknown) => (isString(cwd) ? graph(cwd) : { ok: false, error: 'invalid cwd' }))
  );

  // ---- 终端 ----
  ipcMain.handle(
    'terminal:ensure',
    withMainWindow((win, sessionId: unknown, cwd: unknown) =>
      isString(sessionId) && isString(cwd) ? ensureTerminal(win, sessionId, cwd) : { ok: false, error: 'invalid args' }
    )
  );
  // 输入/尺寸为高频单向通道：校验失败静默丢弃
  ipcMain.on(
    'terminal:write',
    withMainWindow((win, sessionId: unknown, data: unknown) => {
      if (isString(sessionId) && isString(data) && data.length <= 65536) writeTerminal(win, sessionId, data);
    })
  );
  ipcMain.on(
    'terminal:resize',
    withMainWindow((win, sessionId: unknown, cols: unknown, rows: unknown) => {
      if (!isString(sessionId)) return;
      const size = parseTerminalSize(cols, rows);
      if (size) resizeTerminal(win, sessionId, size[0], size[1]);
    })
  );
  ipcMain.handle(
    'terminal:kill',
    withMainWindow((win, sessionId: unknown) => {
      if (isString(sessionId)) killTerminal(win, sessionId);
    })
  );
}
