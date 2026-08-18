import { join } from 'node:path';
import { app, BrowserWindow, Menu, Tray, dialog, nativeImage, type MenuItemConstructorOptions } from 'electron';
import type { TrayAction } from '@dscode/shared';
import { initProjects, listProjectsWithHome } from '@dscode/core';
import { getDbFile } from './data-dir';
import { checkForUpdates } from './updater';
import { mainLabels } from './i18n';


// 托盘图标：Windows/Linux 用满幅圆角应用图标缩到小尺寸（16px 适配系统托盘渲染）。
// resources/ 与 out/ 同级（与窗口图标同一布局，打包配置 files 已含 resources/**）
const TRAY_ICON = join(__dirname, '../../resources/icon-win.png');

// 最近项目子菜单最多展示条数
const MAX_RECENT_PROJECTS = 8;

const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

// 模块级持有实例，避免被 GC 回收导致托盘消失
let tray: Tray | null = null;

export interface TrayHooks {
  /** 取当前主窗口（可能为 null），延迟求值避免创建时序问题 */
  getMainWindow: () => BrowserWindow | null;
  /** 主窗口已销毁时重建（macOS 全关窗口后的兜底） */
  ensureWindow: () => void;
}

/** 恢复/重建主窗口并聚焦 */
function showWindow(hooks: TrayHooks): void {
  let win = hooks.getMainWindow();
  if (!win) {
    hooks.ensureWindow();
    win = hooks.getMainWindow();
  }
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** 窗口重建期间挂起的托盘动作：渲染端尚未订阅，立即投递会丢失，待加载完成后投递 */
let pendingAction: TrayAction | null = null;

/** 先恢复窗口，再把托盘动作发给渲染端执行 */
function sendAction(hooks: TrayHooks, payload: TrayAction): void {
  showWindow(hooks);
  const win = hooks.getMainWindow();
  if (!win) return;
  if (win.webContents.isLoading()) {
    // 窗口重建中（macOS 全关窗口后）：挂起动作，加载完成后再投递，避免被丢弃
    pendingAction = payload;
    win.webContents.once('did-finish-load', () => {
      if (!pendingAction) return;
      win.webContents.send('tray:action', pendingAction);
      pendingAction = null;
    });
    return;
  }
  win.webContents.send('tray:action', payload);
}

/** 消息框封装：有主窗口时作为 parent 弹出（macOS 全关窗口时无 parent 也能弹） */
function showMessageBox(
  win: BrowserWindow | null,
  opts: Electron.MessageBoxOptions
): Promise<Electron.MessageBoxReturnValue> {
  return win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
}

/** 关于对话框：macOS 用原生 about panel，其余平台用消息框（Windows 消息框不支持 type 图标，传自定义图标） */
function showAbout(hooks: TrayHooks): void {
  const labels = mainLabels();
  showWindow(hooks);
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
      applicationName: 'DSCode',
      applicationVersion: app.getVersion(),
      copyright: labels.about.copyright,
      credits: labels.about.subtitle
    });
    app.showAboutPanel();
    return;
  }
  const opts: Electron.MessageBoxOptions = {
    type: 'info',
    title: labels.about.title,
    message: 'DSCode',
    detail: [
      labels.about.subtitle,
      `${labels.about.version} ${app.getVersion()}`,
      '',
      labels.about.copyright
    ].join('\n'),
    buttons: [labels.about.ok],
    noLink: true
  };
  const icon = nativeImage.createFromPath(TRAY_ICON);
  if (!icon.isEmpty()) opts.icon = icon;
  void showMessageBox(hooks.getMainWindow(), opts);
}

/**
 * 动态构建托盘右键菜单：每次弹出时读取最新最近项目。
 * - 打开 DSCode：恢复窗口
 * - 新建会话：渲染端回到新任务页
 * - 最近项目：子菜单列出最近工作空间，点击切换工作目录并回到工作区
 * - 设置：子菜单直达常用版块
 * - 退出：真正结束应用
 */
function buildMenu(hooks: TrayHooks): Menu {
  const labels = mainLabels();
  // 幂等初始化（registerIpcHandlers 已 init，这里兜底保证菜单数据可读）
  initProjects(getDbFile());
  const recent = listProjectsWithHome(getDbFile(), app.getPath('home')).projects.slice(0, MAX_RECENT_PROJECTS);

  const recentItems: MenuItemConstructorOptions[] = recent.length
    ? recent.map(p => ({
        label: p.name,
        toolTip: p.path,
        click: () => sendAction(hooks, { action: 'open-workspace', workspace: p.path })
      }))
    : [{ label: labels.noRecentProjects, enabled: false }];

  const settingsItems: MenuItemConstructorOptions[] = labels.settingsSections.map(s => ({
    label: s.label,
    click: () => sendAction(hooks, { action: 'open-settings', section: s.section })
  }));

  return Menu.buildFromTemplate([
    { label: labels.openDscode, click: () => showWindow(hooks) },
    { type: 'separator' },
    { label: labels.newSession, click: () => sendAction(hooks, { action: 'new-session' }) },
    { label: labels.recentProjects, submenu: recentItems },
    { type: 'separator' },
    { label: labels.settings, submenu: settingsItems },
    { type: 'separator' },
    { label: labels.checkUpdates, click: () => void checkForUpdates() },
    { label: labels.aboutDscode, click: () => showAbout(hooks) },
    { type: 'separator' },
    { label: labels.quit, click: () => app.quit() }
  ]);
}

/**
 * 创建系统托盘：窗口「关闭」时隐藏到托盘驻留后台，从托盘可恢复窗口、执行常用操作或彻底退出。
 * 幂等：重复调用不会创建多个托盘。
 */
export function createTray(hooks: TrayHooks): void {
  if (tray) return;

  const source = nativeImage.createFromPath(TRAY_ICON);
  // 缩到小尺寸便于系统托盘清晰渲染；读图失败时退回原图
  const icon = source.isEmpty() ? source : source.resize({ width: 16, height: 16 });

  tray = new Tray(icon);
  tray.setToolTip('DSCode');

  if (isLinux) {
    // AppIndicator 只认静态 context menu（右键自动弹出；无法按次动态刷新）
    tray.setContextMenu(buildMenu(hooks));
    return;
  }

  // Windows/macOS：右键动态弹出菜单（每次构建读取最新最近项目）
  const popMenu = (): void => tray?.popUpContextMenu(buildMenu(hooks));
  tray.on('right-click', popMenu);
  if (isMac) {
    // macOS 惯例：左键单击也弹菜单
    tray.on('click', popMenu);
  } else {
    // Windows：左键单击恢复窗口
    tray.on('click', () => showWindow(hooks));
  }
}

/** 销毁托盘（真正退出前调用，避免残留） */
export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}