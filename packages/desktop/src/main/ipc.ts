import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import type { SettingsPatch } from '@dscode/shared';
import { loadSettings, saveSettings } from './config';
import { checkout, createBranch, graph, listBranches } from './git';
import { initProjects, listProjectsWithHome, touchProject } from './projects';

/**
 * 业务 IPC 注册（ipcMain.handle / ipcRenderer.invoke）。
 * 每个 handler 校验 sender 属于主窗口、参数为 string 后再执行；
 * 结果统一为 { ok } 判别联合或 null（取消选择）。
 */

function withMainWindow(
  handler: (win: BrowserWindow, ...args: unknown[]) => unknown
): (e: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown {
  return (e, ...args) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return undefined;
    return handler(win, ...args);
  };
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

export function registerIpcHandlers(): void {
  const settingsFile = app.getPath('userData') + '/settings.json';
  const projectsFile = app.getPath('userData') + '/projects.db';
  const homeDir = app.getPath('home');
  initProjects(projectsFile);

  // ---- settings ----
  ipcMain.handle('settings:get', withMainWindow(() => loadSettings(settingsFile, homeDir)));

  ipcMain.handle('settings:set', withMainWindow((_win, patch: unknown) => {
    if (typeof patch !== 'object' || patch === null) return loadSettings(settingsFile, homeDir);
    const record = patch as Record<string, unknown>;
    const next = saveSettings(settingsFile, homeDir, record as SettingsPatch);
    // 工作目录变化且不是家目录 → 记入最近项目
    if (typeof record['workingDirectory'] === 'string' && record['workingDirectory'] !== homeDir) {
      touchProject(projectsFile, record['workingDirectory'] as string);
    }
    return next;
  }));

  // ---- 最近项目 ----
  ipcMain.handle('projects:list', withMainWindow(() => listProjectsWithHome(projectsFile, homeDir)));

  // ---- 目录选择 ----
  ipcMain.handle('dialog:pick-directory', withMainWindow(async win => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Select working directory',
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  }));

  // ---- git ----
  ipcMain.handle('git:list-branches', withMainWindow((_win, cwd: unknown) => (isString(cwd) ? listBranches(cwd) : { ok: false, error: 'invalid cwd' })));
  ipcMain.handle('git:checkout', withMainWindow((_win, cwd: unknown, branch: unknown) =>
    isString(cwd) && isString(branch) ? checkout(cwd, branch) : { ok: false, error: 'invalid args' }
  ));
  ipcMain.handle('git:create-branch', withMainWindow((_win, cwd: unknown, name: unknown) =>
    isString(cwd) && isString(name) ? createBranch(cwd, name) : { ok: false, error: 'invalid args' }
  ));
  ipcMain.handle('git:graph', withMainWindow((_win, cwd: unknown) => (isString(cwd) ? graph(cwd) : { ok: false, error: 'invalid cwd' })));
}
