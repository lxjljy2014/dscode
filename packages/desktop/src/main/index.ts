import { join } from 'node:path';
import { BrowserWindow, app, ipcMain, shell } from 'electron';
import { registerIpcHandlers } from './ipc';
import { disposeAgents, stopWindowAgents } from './agent/agent';
import { disposeTerminals, killWindowTerminals } from './shell/terminal';

const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

// 标题栏高 48px，与渲染端 header 对齐
const TITLEBAR_HEIGHT = 48;

// 应用图标：resources/ 与 out/ 同级（dev/构建产物布局一致；打包配置未引入前暂按此路径兜底）
// macOS Dock 用透明圆角版（内容缩至 80% 安全区，Dock 不会自动给自定义图标加圆角）；
// Windows/Linux 任务栏/标题栏用满幅圆角版（满幅内容避免方形槽位里显得偏小，圆角画在内容上、角外透明）
const MAC_DOCK_ICON = join(__dirname, '../../resources/icon.png');
const WINDOW_ICON = join(__dirname, '../../resources/icon-win.png');

// 允许交给系统浏览器打开的协议白名单
const ALLOWED_OPEN_PROTOCOLS = ['https:', 'http:'];

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
      sandbox: false
    }
  });

  win.on('ready-to-show', () => {
    win.show();
  });

  // 窗口关闭时回收其全部终端会话与该窗口发起的 agent 运行
  win.on('closed', () => {
    killWindowTerminals(win);
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
    if (devUrl ? url.startsWith(devUrl) : url.startsWith('file:')) return;
    event.preventDefault();
    openExternalIfAllowed(url);
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
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

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 退出前回收全部终端会话与 agent 运行
app.on('will-quit', () => {
  disposeTerminals();
  disposeAgents();
});
