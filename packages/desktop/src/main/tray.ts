import { join } from 'node:path';
import { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell, type MenuItemConstructorOptions } from 'electron';
import type { TrayAction } from '@dscode/shared';
import { initProjects, listProjectsWithHome } from '@dscode/core';
import { getDbFile } from './data-dir';

// GitHub 仓库（owner/repo），镜像到 GitHub 后替换为实际地址；可用环境变量 DSCODE_UPDATE_REPO 覆盖
const GITHUB_REPO = process.env['DSCODE_UPDATE_REPO'] ?? 'lxjljy2014/dscode';
// 检查更新走 GitHub Releases「最新版本」API（无需认证，限速 60 次/小时，够用）
const RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
// 更新说明展示最大长度（避免超长 markdown 撑爆对话框）
const MAX_NOTES_LENGTH = 500;
// 更新检查超时（毫秒）
const UPDATE_TIMEOUT_MS = 10_000;

// 托盘图标：Windows/Linux 用满幅圆角应用图标缩到小尺寸（16px 适配系统托盘渲染）。
// resources/ 与 out/ 同级（与窗口图标同一布局，打包配置 files 已含 resources/**）
const TRAY_ICON = join(__dirname, '../../resources/icon-win.png');

// 最近项目子菜单最多展示条数
const MAX_RECENT_PROJECTS = 8;

// 设置子菜单常用版块（对应路由 /settings/:section）
const SETTINGS_SECTIONS = [
  { section: 'general', label: '通用' },
  { section: 'appearance', label: '外观' },
  { section: 'model', label: '模型' },
  { section: 'memory', label: '记忆' },
  { section: 'skills', label: '技能' },
  { section: 'usage', label: '使用统计' }
] as const;

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

/** 先恢复窗口，再把托盘动作发给渲染端执行 */
function sendAction(hooks: TrayHooks, payload: TrayAction): void {
  showWindow(hooks);
  hooks.getMainWindow()?.webContents.send('tray:action', payload);
}

/** 版本号比较：latest > current 视为有新版本（忽略前缀 v） */
function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string): number[] => v.replace(/^v/i, '').split('.').map(n => Number.parseInt(n, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
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
  showWindow(hooks);
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
      applicationName: 'DSCode',
      applicationVersion: app.getVersion(),
      copyright: 'Copyright © 2026 DSCode',
      credits: 'AI 编程助手桌面客户端'
    });
    app.showAboutPanel();
    return;
  }
  const opts: Electron.MessageBoxOptions = {
    type: 'info',
    title: '关于 DSCode',
    message: 'DSCode',
    detail: [
      'AI 编程助手桌面客户端',
      `版本 ${app.getVersion()}`,
      '',
      'Copyright © 2026 DSCode'
    ].join('\n'),
    buttons: ['确定'],
    noLink: true
  };
  const icon = nativeImage.createFromPath(TRAY_ICON);
  if (!icon.isEmpty()) opts.icon = icon;
  void showMessageBox(hooks.getMainWindow(), opts);
}

/**
 * 检查更新（GitHub Releases）：拉取最新 Release 对比当前版本，按结果弹提示。
 * - 有新版：提示版本/更新说明，可「前往下载」（交给系统浏览器，避免未签名静默安装被 SmartScreen 拦截）
 * - 无新版：提示已是最新
 * - 未发布/拉取失败：提示相应错误（含原因）
 */
async function checkForUpdates(hooks: TrayHooks): Promise<void> {
  showWindow(hooks);
  const win = hooks.getMainWindow();
  const current = app.getVersion();

  let release: Record<string, unknown>;
  try {
    const res = await fetch(RELEASES_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS)
    });
    if (res.status === 404) {
      await showMessageBox(win, {
        type: 'info',
        title: '检查更新',
        message: '尚未发布任何版本',
        detail: '仓库还没有 Release',
        buttons: ['确定']
      });
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    release = (await res.json()) as Record<string, unknown>;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await showMessageBox(win, {
      type: 'error',
      title: '检查更新失败',
      message: '无法连接更新服务器',
      detail,
      buttons: ['确定']
    });
    return;
  }

  const tagName = release['tag_name'];
  const latest = typeof tagName === 'string' ? tagName.replace(/^v/i, '') : '';
  if (!latest) {
    await showMessageBox(win, {
      type: 'error',
      title: '检查更新失败',
      message: '未找到版本信息',
      detail: 'Release 缺少 tag',
      buttons: ['确定']
    });
    return;
  }

  if (!isNewerVersion(latest, current)) {
    await showMessageBox(win, {
      type: 'info',
      title: '检查更新',
      message: '已是最新版本',
      detail: `当前版本 v${current}`,
      buttons: ['确定']
    });
    return;
  }

  // 找 Windows 安装包直链：优先含 Setup 的 .exe，否则第一个 .exe
  const rawAssets = release['assets'];
  const assets = Array.isArray(rawAssets) ? (rawAssets as Array<Record<string, unknown>>) : [];
  let downloadUrl = '';
  for (const a of assets) {
    const name = a['name'];
    const url = a['browser_download_url'];
    if (typeof name === 'string' && typeof url === 'string' && name.endsWith('.exe') && name.includes('Setup')) {
      downloadUrl = url;
      break;
    }
  }
  if (!downloadUrl) {
    for (const a of assets) {
      const name = a['name'];
      const url = a['browser_download_url'];
      if (typeof name === 'string' && typeof url === 'string' && name.endsWith('.exe')) {
        downloadUrl = url;
        break;
      }
    }
  }
  const htmlUrl = typeof release['html_url'] === 'string' ? release['html_url'] : '';

  const rawBody = release['body'];
  let body = typeof rawBody === 'string' ? rawBody.trim() : '';
  if (body.length > MAX_NOTES_LENGTH) body = `${body.slice(0, MAX_NOTES_LENGTH)}…`;

  const detail = [`最新版本 v${latest}`, body ? `\n\n${body}` : ''].join('');

  // 跳转目标：优先资产直链（直接下载安装包），否则 Release 页面
  const target = downloadUrl || htmlUrl;
  if (target) {
    const r = await showMessageBox(win, {
      type: 'info',
      title: '发现新版本',
      message: `发现新版本 v${latest}`,
      detail,
      buttons: ['前往下载', '取消']
    });
    if (r.response === 0) void shell.openExternal(target);
  } else {
    await showMessageBox(win, {
      type: 'info',
      title: '发现新版本',
      message: `发现新版本 v${latest}`,
      detail,
      buttons: ['确定']
    });
  }
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
  // 幂等初始化（registerIpcHandlers 已 init，这里兜底保证菜单数据可读）
  initProjects(getDbFile());
  const recent = listProjectsWithHome(getDbFile(), app.getPath('home')).projects.slice(0, MAX_RECENT_PROJECTS);

  const recentItems: MenuItemConstructorOptions[] = recent.length
    ? recent.map(p => ({
        label: p.name,
        toolTip: p.path,
        click: () => sendAction(hooks, { action: 'open-workspace', workspace: p.path })
      }))
    : [{ label: '（无最近项目）', enabled: false }];

  const settingsItems: MenuItemConstructorOptions[] = SETTINGS_SECTIONS.map(s => ({
    label: s.label,
    click: () => sendAction(hooks, { action: 'open-settings', section: s.section })
  }));

  return Menu.buildFromTemplate([
    { label: '打开 DSCode', click: () => showWindow(hooks) },
    { type: 'separator' },
    { label: '新建会话', click: () => sendAction(hooks, { action: 'new-session' }) },
    { label: '最近项目', submenu: recentItems },
    { type: 'separator' },
    { label: '设置', submenu: settingsItems },
    { type: 'separator' },
    { label: '检查更新', click: () => void checkForUpdates(hooks) },
    { label: '关于 DSCode', click: () => showAbout(hooks) },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
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