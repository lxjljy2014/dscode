import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdaterState } from '@dscode/shared';

// 主窗口引用（弹提示 / 推送状态）
let getMainWindow: (() => BrowserWindow | null) | null = null;
// 手动检查（托盘触发）时无更新/失败要弹提示；启动自动检查则静默
let manualCheck = false;
// 当前下载版本（download-progress 事件无 version 字段，需在 update-available 时记下）
let downloadingVersion = '';
// 当前状态快照（渲染端加载后主动拉取，避免错过已推送的状态）
let currentState: UpdaterState = { state: 'idle' };

/** 推送状态给渲染端（驱动侧边栏更新按钮） */
function pushState(state: UpdaterState): void {
  currentState = state;
  getMainWindow?.()?.webContents.send('updater:state', state);
}

/** 校验 IPC 发送方属于主窗口 */
function isMainWindowSender(e: IpcMainInvokeEvent): boolean {
  const win = getMainWindow?.();
  return !!win && win.webContents === e.sender;
}

/** 弹窗封装（手动检查无更新/失败时用） */
async function showDialog(opts: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  const win = getMainWindow?.() ?? null;
  return win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
}

/**
 * 初始化自动更新（electron-updater）：
 * - 不自动下载：检测到新版本后推送 available，由渲染端「更新」按钮触发下载
 * - 下载进度实时推送（渲染端环形进度条展示）
 * - 下载完成推送 downloaded，渲染端显示「重启更新」按钮
 * - 手动检查（托盘）无更新/失败时弹提示；启动自动检查静默
 */
export function initAutoUpdater(mainWindowGetter: () => BrowserWindow | null): void {
  getMainWindow = mainWindowGetter;

  autoUpdater.logger = console;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => pushState({ state: 'checking' }));
  autoUpdater.on('update-available', info => {
    downloadingVersion = info.version;
    pushState({ state: 'available', version: info.version });
  });
  autoUpdater.on('update-not-available', () => {
    pushState({ state: 'not-available' });
    if (manualCheck) {
      void showDialog({
        type: 'info',
        title: '检查更新',
        message: '已是最新版本',
        detail: `当前版本 v${app.getVersion()}`,
        buttons: ['确定']
      });
    }
    manualCheck = false;
  });
  autoUpdater.on('download-progress', p => {
    pushState({ state: 'downloading', version: downloadingVersion, percent: Math.floor(p.percent) });
  });
  autoUpdater.on('update-downloaded', info => {
    pushState({ state: 'downloaded', version: info.version });
  });
  autoUpdater.on('error', err => {
    pushState({ state: 'error', message: err instanceof Error ? err.message : String(err) });
    if (manualCheck) {
      void showDialog({
        type: 'error',
        title: '检查更新失败',
        message: '无法完成自动更新',
        detail: err instanceof Error ? err.message : String(err),
        buttons: ['确定']
      });
    }
    manualCheck = false;
  });

  // 渲染端触发：开始下载 / 重启安装 / 拉取当前状态
  ipcMain.handle('updater:download', e => {
    if (!isMainWindowSender(e)) return;
    void autoUpdater.downloadUpdate().catch(err => console.error('[updater] 下载失败', err));
  });
  ipcMain.handle('updater:install', e => {
    if (!isMainWindowSender(e)) return;
    autoUpdater.quitAndInstall();
  });
  ipcMain.handle('updater:get-state', e => {
    if (!isMainWindowSender(e)) return { state: 'idle' } as UpdaterState;
    return currentState;
  });
}

/** 手动检查更新（托盘「检查更新」触发）：无更新/失败会弹提示 */
export async function checkForUpdates(): Promise<void> {
  manualCheck = true;
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    console.error('[updater] 检查更新异常', e);
  }
}

/** 启动后自动检查更新（静默）：检测到新版本时仅点亮侧边栏更新按钮 */
export function scheduleAutoCheck(delayMs = 5000): void {
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch(e => console.error('[updater] 自动检查异常', e));
  }, delayMs);
}