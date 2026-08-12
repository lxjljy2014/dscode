import { contextBridge, ipcRenderer } from 'electron'

const api = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },
  /** 同步 Windows 原生标题栏悬浮按钮的配色（主题切换时调用） */
  setTitleBarOverlay: (options: { color: string; symbolColor: string }) =>
    ipcRenderer.send('win:set-titlebar-overlay', options)
}

export type DsCodeApi = typeof api

contextBridge.exposeInMainWorld('dscode', api)
