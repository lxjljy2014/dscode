import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { writeFile } from 'node:fs/promises';
import type { SettingsPatch } from '@dscode/shared';
import {
  backfillSessions,
  buildIndex,
  createSqliteLlmCache,
  initLlmCache,
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
  setSessionStats,
  touchProject,
  upsertMessage,
  upsertSession,
  verifyProvider
} from '@dscode/core';
import { resolveConfirm, startAgent, stopAgent } from './agent/agent';
import { authorizeAttachmentPaths, isAuthorizedAttachmentPath, readAttachment } from './attachment';
import { compactSession } from './compact';
import { loadAppSettings, saveAppSettings } from './settings';
import { ensureTerminal, killTerminal, resizeTerminal, writeTerminal } from './shell/terminal';
import { isMessage, isSession, isSessionStats, isSettingsPatch, isString, parseTerminalSize } from './validators';
import { getConfigDir, getDbFile, getPluginsDir, getSessionsDir } from './data-dir';
import { mainLabels } from './i18n';

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
  const settingsDir = getConfigDir();
  // 关系型数据统一一个库（dscode.db，按表组织）；会话为 JSONL 文件
  const dbFile = getDbFile();
  const sessionsRoot = getSessionsDir();
  const pluginsDir = getPluginsDir();
  const homeDir = app.getPath('home');
  initProjects(dbFile);
  initSessions(sessionsRoot);
  initUsage(dbFile);
  initIndex(dbFile);
  backfillSessions(sessionsRoot, loadAppSettings(settingsDir, homeDir).workingDirectory);

  // ---- settings ----
  ipcMain.handle(
    'settings:get',
    withMainWindow(() => loadAppSettings(settingsDir, homeDir))
  );

  ipcMain.handle(
    'settings:set',
    withMainWindow((_win, patch: unknown) => {
      // 字段白名单校验：拒绝含未知 key 的 patch（防渲染端注入），返回当前设置不变
      if (!isSettingsPatch(patch)) return loadAppSettings(settingsDir, homeDir);
      const record = patch as Record<string, unknown>;
      const next = saveAppSettings(settingsDir, homeDir, record as SettingsPatch);
      // 工作目录变化且不是家目录 → 记入最近项目
      if (typeof record['workingDirectory'] === 'string' && record['workingDirectory'] !== homeDir) {
        touchProject(dbFile, record['workingDirectory'] as string);
      }
      return next;
    })
  );

  // ---- 最近项目 ----
  ipcMain.handle(
    'projects:list',
    withMainWindow(() => listProjectsWithHome(dbFile, homeDir))
  );
  ipcMain.handle(
    'projects:remove',
    withMainWindow((_win, path: unknown) => {
      if (!isString(path)) return { ok: false as const, error: 'invalid path' };
      removeProject(dbFile, path);
      return { ok: true as const };
    })
  );

  // ---- 目录选择 ----
  ipcMain.handle(
    'dialog:pick-directory',
    withMainWindow(async win => {
      const result = await dialog.showOpenDialog(win, {
        title: mainLabels().dialogs.pickDirectory,
        properties: ['openDirectory', 'createDirectory']
      });
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
    })
  );

  // ---- 文件选择（附件 / @ 引用） ----
  ipcMain.handle(
    'dialog:pick-files',
    withMainWindow(async win => {
      const result = await dialog.showOpenDialog(win, {
        title: mainLabels().dialogs.pickFiles,
        properties: ['openFile', 'multiSelections']
      });
      const paths = result.canceled ? null : result.filePaths;
      // 记录本次选中的路径：attachment:read 只回传这些已授权路径，防越权读任意文件
      authorizeAttachmentPaths(paths);
      return paths;
    })
  );
  ipcMain.handle(
    'attachment:read',
    withMainWindow((_win, absPath: unknown) => {
      if (!isString(absPath)) return { ok: false as const, error: 'invalid path' };
      if (!isAuthorizedAttachmentPath(absPath)) return { ok: false as const, error: '未授权的路径' };
      return readAttachment(absPath);
    })
  );

  // ---- 保存文件（代码块下载） ----
  ipcMain.handle(
    'dialog:save-file',
    withMainWindow(async (win, defaultName: unknown, content: unknown) => {
      if (!isString(defaultName) || !isString(content)) return { ok: false as const, error: 'invalid args' };
      const result = await dialog.showSaveDialog(win, {
        title: mainLabels().dialogs.saveFile,
        defaultPath: defaultName
      });
      if (result.canceled || !result.filePath) return { ok: false as const, canceled: true as const };
      try {
        await writeFile(result.filePath, content, 'utf8');
        return { ok: true as const };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
      }
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
    withMainWindow(() => listUsage(dbFile))
  );

  // ---- LLM 回复缓存（省成本；命中率在「使用统计」页展示） ----
  initLlmCache(dbFile);
  ipcMain.handle(
    'usage:cache-stats',
    withMainWindow(() => createSqliteLlmCache(dbFile).stats())
  );
  ipcMain.handle(
    'usage:cache-clear',
    withMainWindow(() => createSqliteLlmCache(dbFile).clear())
  );

  // ---- MCP ----
  ipcMain.handle(
    'mcp:list-tools',
    withMainWindow(async (_win, serverId: unknown) => {
      // 只接受 server id：command/args 从主进程持久化配置按 id 读取，渲染端不可注入任意命令
      if (!isString(serverId)) return { ok: false as const, error: 'invalid args' };
      const server = loadAppSettings(settingsDir, homeDir).mcpServers.find(s => s.id === serverId);
      if (!server) return { ok: false as const, error: 'unknown server' };
      try {
        const tools = await listMcpTools({ command: server.command, args: server.args });
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
  ipcMain.handle(
    'index:stats',
    withMainWindow(() => indexStats(dbFile))
  );
  ipcMain.handle(
    'index:build',
    withMainWindow(() => buildIndex(loadAppSettings(settingsDir, homeDir).workingDirectory, dbFile))
  );
  ipcMain.handle(
    'index:search',
    withMainWindow((_win, query: unknown) => (isString(query) ? searchIndex(dbFile, query) : []))
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
    withMainWindow((win, sessionId: unknown, model: unknown, messages: unknown, subagentId: unknown, reasoningEffort: unknown) =>
      isString(sessionId)
        ? startAgent(win, sessionId, model, messages, subagentId, reasoningEffort)
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
    withMainWindow(async () => scanTree(loadAppSettings(settingsDir, homeDir).workingDirectory))
  );
  ipcMain.handle(
    'workspace:read-file',
    withMainWindow(async (_win, relPath: unknown) => {
      const cwd = loadAppSettings(settingsDir, homeDir).workingDirectory;
      return isString(relPath) ? readWorkspaceFile(cwd, relPath) : { ok: false, error: 'invalid path' };
    })
  );

  // ---- 会话持久化 ----
  ipcMain.handle(
    'sessions:list',
    withMainWindow(() => listSessions(sessionsRoot))
  );
  ipcMain.handle(
    'sessions:create',
    withMainWindow((_win, session: unknown) => {
      if (!isSession(session)) return { ok: false, error: 'invalid session' };
      upsertSession(sessionsRoot, session);
      return { ok: true };
    })
  );
  ipcMain.handle(
    'sessions:append',
    withMainWindow((_win, sessionId: unknown, message: unknown) => {
      if (!isString(sessionId) || !isMessage(message)) return { ok: false, error: 'invalid args' };
      upsertMessage(sessionsRoot, sessionId, message);
      return { ok: true };
    })
  );
  ipcMain.handle(
    'sessions:archive',
    withMainWindow((_win, sessionId: unknown, archived: unknown) => {
      if (!isString(sessionId) || typeof archived !== 'boolean') return { ok: false, error: 'invalid args' };
      setSessionArchived(sessionsRoot, sessionId, archived);
      return { ok: true };
    })
  );

  // ---- git ----

  ipcMain.handle(
    'sessions:stats',
    withMainWindow((_win, sessionId: unknown, stats: unknown) => {
      if (!isString(sessionId) || !isSessionStats(stats)) return { ok: false, error: 'invalid args' };
      setSessionStats(sessionsRoot, sessionId, stats);
      return { ok: true };
    })
  );
  ipcMain.handle(
    'session:compact',
    withMainWindow((_win, sessionId: unknown) =>
      isString(sessionId) ? compactSession(sessionId) : { ok: false as const, error: 'invalid args' }
    )
  );
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