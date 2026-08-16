import { app, dialog, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

// 主窗口引用（弹更新提示时作为 parent）
let getMainWindow: (() => BrowserWindow | null) | null = null;

/** 弹窗封装：有主窗口时作 parent（全关窗口时无 parent 也能弹） */
async function showDialog(opts: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  const win = getMainWindow?.() ?? null;
  return win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
}

/**
 * 初始化自动更新（electron-updater）：
 * - 检查到新版本时自动静默下载（autoDownload，无需用户干预）
 * - 下载完成弹窗询问是否立即重启安装
 * - 无更新 / 失败弹窗提示
 *
 * 静默更新对未签名应用可行：安装包由应用自身下载（不带浏览器 Mark-of-the-Web），
 * 不会触发 SmartScreen 对下载文件的拦截；仅可能在安装时出现 UAC 提权提示，
 * 或 Defender 因未签名而给出信誉告警（不影响流程）。
 */
export function initAutoUpdater(mainWindowGetter: () => BrowserWindow | null): void {
  getMainWindow = mainWindowGetter;

  autoUpdater.logger = console;
  // 检查到更新后自动静默下载，无需再手动调用 downloadUpdate
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', info => {
    console.log('[updater] 发现新版本，开始静默下载', info.version);
  });

  autoUpdater.on('update-not-available', () => {
    void showDialog({
      type: 'info',
      title: '检查更新',
      message: '已是最新版本',
      detail: `当前版本 v${app.getVersion()}`,
      buttons: ['确定']
    });
  });

  autoUpdater.on('update-downloaded', info => {
    void showDialog({
      type: 'info',
      title: '发现新版本',
      message: `新版本 v${info.version} 已下载完成`,
      detail: '是否立即重启并安装？',
      buttons: ['立即重启安装', '稍后']
    }).then(r => {
      if (r.response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on('error', err => {
    console.error('[updater] 更新失败', err);
    void showDialog({
      type: 'error',
      title: '检查更新失败',
      message: '无法完成自动更新',
      detail: err instanceof Error ? err.message : String(err),
      buttons: ['确定']
    });
  });
}

/** 触发一次检查更新（托盘「检查更新」调用） */
export async function checkForUpdates(): Promise<void> {
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    console.error('[updater] 检查更新异常', e);
  }
}
