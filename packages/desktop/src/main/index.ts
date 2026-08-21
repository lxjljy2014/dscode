import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, app, ipcMain, shell } from 'electron';
import { registerIpcHandlers, runDeferredInit } from './ipc';
import { disposeAgents, stopWindowAgents, disposeMcpConnections } from './agent/agent';
import { migrateLegacyData } from './data-dir';
import { disposeTerminals, killWindowTerminals } from './shell/terminal';
import { createTray, destroyTray } from './tray';
import { initAutoUpdater, scheduleAutoCheck } from './updater';

const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

// 标题栏高 48px，与渲染端 header 对齐
const TITLEBAR_HEIGHT = 48;

// 应用图标：resources/ 与 out/ 同级（dev/构建产物布局一致；打包配置未引入前暂按此路径兜底）
// macOS Dock 用透明圆角版（内容缩至 80% 安全区，Dock 不会自动给自定义图标加圆角）；
// Windows/Linux 任务栏/标题栏用满幅圆角版（满幅内容避免方形槽位里显得偏小，圆角画在内容上、角外透明）
const MAC_DOCK_ICON = join(__dirname, '../../resources/icon.png');
const WINDOW_ICON = join(__dirname, '../../resources/icon-win.png');
// 生产环境唯一放行的本地导航目标（应用自身 renderer/index.html）
const RENDERER_INDEX_URL = pathToFileURL(join(__dirname, '../renderer/index.html')).href;

// 允许交给系统浏览器打开的协议白名单
const ALLOWED_OPEN_PROTOCOLS = ['https:', 'http:'];

// 当前主窗口引用（窗口销毁后置空），供托盘恢复窗口与 macOS activate 使用
let mainWindow: BrowserWindow | null = null;
// 是否为真正退出：托盘「退出」/系统关机时置位，放行窗口 close（否则一律隐藏到托盘）
let isQuitting = false;
// 延后初始化只跑一次（窗口可能销毁重建，回填等操作无需重复执行）
let deferredInitDone = false;

// 单实例锁：应用数据（sqlite 库 / JSONL 会话）不支持多进程并发读写，二次启动只聚焦已有实例
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();

// 已有实例运行时用户再次启动：恢复并聚焦主窗口（窗口已销毁则重建，与托盘恢复行为一致）
app.on('second-instance', () => {
  if (mainWindow) {
    if (!mainWindow.isVisible()) mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else {
    createWindow();
  }
});

/** 校验后把 http(s) 链接交给系统浏览器打开，其余协议一律忽略 */
function openExternalIfAllowed(url: string): void {
  try {
    if (ALLOWED_OPEN_PROTOCOLS.includes(new URL(url).protocol)) {
      shell.openExternal(url);
    }
  } catch {
    // URL 无法解析时直接忽略
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0d0d0d',
    autoHideMenuBar: true,
    // 窗口图标（Windows/Linux 任务栏与标题栏；macOS 的 Dock 图标见 whenReady）
    icon: WINDOW_ICON,
    // 隐藏系统标题栏，使用 Electron 原生悬浮控件：
    // macOS 红绿灯 / Windows 系统绘制的最小化、最大化、关闭按钮
    titleBarStyle: 'hidden',
    // macOS：红绿灯悬浮在 header 左侧，垂直居中（渲染端左侧留 84px）
    ...(isMac ? { trafficLightPosition: { x: 14, y: 16 } } : {}),
    // Windows：原生悬浮按钮叠在 header 右侧（渲染端右侧留出按钮宽度）
    // 初始为暗色主题色值，渲染端主题切换时通过 IPC 同步
    ...(isWindows
      ? { titleBarOverlay: { color: 'rgba(0, 0, 0, 0)', symbolColor: '#ececec', height: TITLEBAR_HEIGHT } }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // preload 仅使用 contextBridge/ipcRenderer/process.platform/versions，均支持沙箱化，收紧权限面
      sandbox: true
    }
  });

  win.on('ready-to-show', () => {
    win.show();
    // 首窗可见后再跑延后初始化（旧会话回填等非关键路径的同步 IO），不阻塞首窗出现
    if (!deferredInitDone) {
      deferredInitDone = true;
      runDeferredInit();
    }
  });

  // 关闭按钮（系统标题栏 / macOS 红绿灯）→ 隐藏到托盘驻留后台；
  // 仅托盘「退出」或系统退出（before-quit 置位 isQuitting）时真正关闭
  win.on('close', event => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  // 窗口真正销毁时回收其全部终端会话与该窗口发起的 agent 运行
  // 捕获窗口 webContents id：closed 事件触发时窗口已销毁，不能再访问 win.webContents
  const webContentsId = win.webContents.id;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    killWindowTerminals(webContentsId);
    stopWindowAgents(win);
  });

  // 新窗口一律拒绝，仅 http(s) 链接交给系统浏览器
  win.webContents.setWindowOpenHandler(details => {
    openExternalIfAllowed(details.url);
    return { action: 'deny' };
  });

  // 拦截窗口内导航：仅放行自身 dev server / 本地文件，其余交给系统浏览器或直接拦截
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    if (devUrl ? url.startsWith(devUrl) : url.startsWith(RENDERER_INDEX_URL)) return;
    event.preventDefault();
    openExternalIfAllowed(url);
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow = win;
}

app.whenReady().then(() => {
  // 未获单实例锁：本实例已在 quit 流程中，不再初始化（防御 quit 与 ready 的竞态）
  if (!hasInstanceLock) return;
  // 先把旧 userData 位置的应用数据迁到 ~/.dscode（必须在任何数据库/设置被打开之前）
  migrateLegacyData();
  // 业务 IPC（settings / 最近项目 / 目录选择 / git）
  registerIpcHandlers();

  // macOS Dock 图标
  if (isMac) app.dock?.setIcon(MAC_DOCK_ICON);

  // 渲染端主题切换后同步悬浮按钮符号色（仅 Windows 生效；背景色固定透明）
  ipcMain.on('win:set-titlebar-overlay', (e, options: unknown) => {
    if (!isWindows) return;
    // 只接受主窗口发来的请求，并校验参数类型
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    if (
      typeof options !== 'object' ||
      options === null ||
      typeof (options as Record<string, unknown>)['symbolColor'] !== 'string'
    ) {
      return;
    }
    const { symbolColor } = options as { symbolColor: string };
    try {
      win.setTitleBarOverlay({ color: 'rgba(0, 0, 0, 0)', symbolColor, height: TITLEBAR_HEIGHT });
    } catch {
      // 非法颜色值由 Electron 抛错，兜底避免主进程崩溃
    }
  });

  // Windows 系统通知需要 AUMID（免安装版/dev 下 electron-builder 未注入）
  if (isWindows) app.setAppUserModelId('com.dscode.app');

  // 自动更新（electron-updater）：托盘「检查更新」触发；静默下载 + 下载完成提示重启安装
  initAutoUpdater(() => mainWindow);
  // 启动后延迟自动检查更新（静默：仅在有新版本下载完成时才打扰用户）
  scheduleAutoCheck();

  // 系统托盘：窗口「关闭」后驻留后台，可从托盘恢复窗口、执行常用操作或退出应用
  createTray({
    getMainWindow: () => mainWindow,
    // 托盘动作时窗口已销毁（macOS 全关窗口）则重建
    ensureWindow: () => createWindow()
  });

  createWindow();

  app.on('activate', () => {
    // macOS：点击 Dock 图标恢复隐藏的窗口；窗口已销毁（退出流程后）则重建
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
});

// 真正退出（托盘「退出」菜单或系统关机）：置位放行窗口 close，并销毁托盘
app.on('before-quit', () => {
  isQuitting = true;
  destroyTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 退出前回收全部终端会话与 agent 运行
app.on('will-quit', () => {
  disposeTerminals();
  disposeAgents();
  disposeMcpConnections();
});