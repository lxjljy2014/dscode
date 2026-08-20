import { app, autoUpdater as nativeUpdater, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdaterState } from '@dscode/shared';
import { mainLabels } from './i18n';

// 主窗口引用（弹提示 / 推送状态）
let getMainWindow: (() => BrowserWindow | null) | null = null;
// 手动检查（托盘触发）计数：无更新/失败时弹提示；启动自动检查则静默。
// 用计数而非布尔，避免自动/手动并发时 update-not-available/error 回调互相覆盖弹窗状态
let manualChecksPending = 0;

// macOS 点击「重启更新」后，Squirrel 正常应立即退出并安装；超时仍存活视为安装失败
const INSTALL_CONFIRM_TIMEOUT_MS = 5000;

function consumeManualCheck(): boolean {
  if (manualChecksPending > 0) {
    manualChecksPending--;
    return true;
  }
  return false;
}
// 当前下载版本（download-progress 事件无 version 字段，需在 update-available 时记下）
let downloadingVersion = '';
// 当前状态快照（渲染端加载后主动拉取，避免错过已推送的状态）
let currentState: UpdaterState = { state: 'idle' };

/** 推送状态给渲染端（驱动侧边栏更新按钮） */
function pushState(state: UpdaterState): void {
  currentState = state;
  const win = getMainWindow?.();
  if (win && !win.isDestroyed()) win.webContents.send('updater:state', state);
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
    consumeManualCheck(); // 手动检查找到新版本也算完成，不残留计数
  });
  autoUpdater.on('update-not-available', () => {
    pushState({ state: 'not-available' });
    if (consumeManualCheck()) {
      const labels = mainLabels();
      void showDialog({
        type: 'info',
        title: labels.updater.checkTitle,
        message: labels.updater.latest,
        detail: `${labels.updater.currentVersion} v${app.getVersion()}`,
        buttons: [labels.updater.ok]
      });
    }
  });
  autoUpdater.on('download-progress', p => {
    pushState({ state: 'downloading', version: downloadingVersion, percent: Math.floor(p.percent) });
  });
  autoUpdater.on('update-downloaded', info => {
    pushState({ state: 'downloaded', version: info.version });
  });
  autoUpdater.on('error', err => {
    pushState({ state: 'error', message: err instanceof Error ? err.message : String(err) });
    if (consumeManualCheck()) {
      const labels = mainLabels();
      void showDialog({
        type: 'error',
        title: labels.updater.failTitle,
        message: labels.updater.failMessage,
        detail: err instanceof Error ? err.message : String(err),
        buttons: [labels.updater.ok]
      });
    }
  });

  // macOS：electron-updater 把安装委托给 Squirrel.Mac（原生 autoUpdater），其错误（典型如
  // 未签名构建的 "Could not get code signature"）不经 electron-updater 的 error 事件暴露——
  // 不转发的话 UI 停留在 downloaded 死按钮。此处只推状态，不弹窗（由 install 兜底提示）。
  nativeUpdater.on('error', err => {
    console.error('[updater] Squirrel 原生错误', err);
    pushState({ state: 'error', message: err instanceof Error ? err.message : String(err) });
  });

  // 渲染端触发：开始下载 / 重启安装 / 拉取当前状态
  ipcMain.handle('updater:download', e => {
    if (!isMainWindowSender(e)) return;
    void autoUpdater.downloadUpdate().catch(err => console.error('[updater] 下载失败', err));
  });
  ipcMain.handle('updater:install', e => {
    if (!isMainWindowSender(e)) return;
    // macOS 上 Squirrel 未就绪时 quitAndInstall 只是注册等待、无可见动作（未签名即永不就绪）。
    // 超时兜底：若干秒后本进程仍存活（Squirrel 未执行重启），明确弹窗告知失败原因与手动更新指引。
    if (process.platform === 'darwin') {
      setTimeout(() => {
        const labels = mainLabels();
        void showDialog({
          type: 'warning',
          title: labels.updater.installFailTitle,
          message: labels.updater.installFailMessage,
          detail: labels.updater.installFailHint,
          buttons: [labels.updater.ok]
        });
      }, INSTALL_CONFIRM_TIMEOUT_MS);
    }
    autoUpdater.quitAndInstall();
  });
  ipcMain.handle('updater:get-state', e => {
    if (!isMainWindowSender(e)) return { state: 'idle' } as UpdaterState;
    return currentState;
  });
}

/** 手动检查更新（托盘「检查更新」触发）：无更新/失败会弹提示 */
export async function checkForUpdates(): Promise<void> {
  manualChecksPending++;
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    consumeManualCheck(); // 检查本身抛错时消费计数，避免残留
    console.error('[updater] 检查更新异常', e);
  }
}

/** 启动后自动检查更新（静默）：检测到新版本时仅点亮侧边栏更新按钮 */
export function scheduleAutoCheck(delayMs = 5000): void {
  // 未打包（dev/electron-vite）无 dev-app-update.yml，autoUpdater 检查必然报错，跳过避免控制台噪音
  if (!app.isPackaged) return;
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch(e => console.error('[updater] 自动检查异常', e));
  }, delayMs);
}