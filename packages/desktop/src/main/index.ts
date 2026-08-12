import { join } from 'node:path'
import { BrowserWindow, app, ipcMain, shell } from 'electron'

const isMac = process.platform === 'darwin'
const isWindows = process.platform === 'win32'

// 标题栏高 48px，与渲染端 header 对齐
const TITLEBAR_HEIGHT = 48

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0d0d0d',
    autoHideMenuBar: true,
    // 隐藏系统标题栏，使用 Electron 原生悬浮控件：
    // macOS 红绿灯 / Windows 系统绘制的最小化、最大化、关闭按钮
    titleBarStyle: 'hidden',
    // macOS：红绿灯悬浮在 header 左侧，垂直居中（渲染端左侧留 84px）
    ...(isMac ? { trafficLightPosition: { x: 14, y: 16 } } : {}),
    // Windows：原生悬浮按钮叠在 header 右侧（渲染端右侧留出按钮宽度）
    // 初始为暗色主题色值，渲染端主题切换时通过 IPC 同步
    ...(isWindows
      ? { titleBarOverlay: { color: '#171717', symbolColor: '#ececec', height: TITLEBAR_HEIGHT } }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler(details => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // 渲染端主题切换后同步悬浮按钮配色（仅 Windows 生效）
  ipcMain.on(
    'win:set-titlebar-overlay',
    (e, options: { color: string; symbolColor: string }) => {
      if (!isWindows) return
      BrowserWindow.fromWebContents(e.sender)?.setTitleBarOverlay({
        color: options.color,
        symbolColor: options.symbolColor,
        height: TITLEBAR_HEIGHT
      })
    }
  )

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
