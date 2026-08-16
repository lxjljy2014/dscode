import { join } from 'node:path';
import { app, dialog, Notification, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

// 主窗口引用（弹更新提示时作为 parent）
let getMainWindow: (() => BrowserWindow | null) | null = null;
// 手动检查（托盘触发）时无更新/失败也要弹提示；启动自动检查则静默
let manualCheck = false;
// 下载进度通知节流：每 20% 通知一次
let lastNotifiedPercent = -1;

// 通知图标（与窗口图标同源）
const NOTIFY_ICON = join(__dirname, '../../resources/icon-win.png');

/** 系统通知（Windows/macOS/Linux），失败不阻塞更新流程 */
function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  try {
    new Notification({ title, body, icon: NOTIFY_ICON }).show();
  } catch (e) {
    console.error('[updater] 系统通知失败', e);
  }
}

/** 弹窗封装：有主窗口时作 parent（全关窗口时无 parent 也能弹） */
async function showDialog(opts: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  const win = getMainWindow?.() ?? null;
  return win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
}

/**
 * 初始化自动更新（electron-updater）：
 * - 检查到新版本时自动静默下载，并用系统通知提示进度（每 20%）
 * - 下载完成弹窗询问是否立即重启安装
 * - 手动检查（托盘）时无更新/失败弹提示；启动自动检查则静默，仅在下载完成时打扰
 *
 * 静默更新对未签名应用可行：安装包由应用自身下载（不带浏览器 Mark-of-the-Web），
 * 不会触发 SmartScreen 对下载文件的拦截；仅可能在安装时出现 UAC 提权提示。
 */
export function initAutoUpdater(mainWindowGetter: () => BrowserWindow | null): void {
  getMainWindow = mainWindowGetter;

  autoUpdater.logger = console;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', info => {
    lastNotifiedPercent = -1;
    notify('发现新版本', `正在后台下载 v${info.version}`);
    console.log('[updater] 发现新版本，开始静默下载', info.version);
  });

  autoUpdater.on('download-progress', p => {
    const percent = Math.floor(p.percent);
    if (percent - lastNotifiedPercent >= 20) {
      lastNotifiedPercent = percent;
      notify('正在下载更新', `${percent}%`);
    }
  });

  autoUpdater.on('update-not-available', () => {
    lastNotifiedPercent = -1;
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

  autoUpdater.on('update-downloaded', info => {
    lastNotifiedPercent = -1;
    manualCheck = false;
    notify('更新已就绪', `新版本 v${info.version} 已下载完成`);
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
    lastNotifiedPercent = -1;
    console.error('[updater] 更新失败', err);
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

/** 启动后自动检查更新（静默）：发现新版本时后台下载，下载完成才打扰用户 */
export function scheduleAutoCheck(delayMs = 5000): void {
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch(e => console.error('[updater] 自动检查异常', e));
  }, delayMs);
}