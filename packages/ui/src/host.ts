/**
 * 宿主（Electron preload）注入到 window.dscode 的桥接 API。
 * 纯浏览器环境下为 undefined，组件需做降级处理。
 */

export interface TitleBarOverlayOptions {
  /** 标题栏背景色（与 header 背景一致） */
  color: string
  /** 按钮符号色 */
  symbolColor: string
}

export interface HostApi {
  platform: string
  versions: Record<string, string | undefined>
  setTitleBarOverlay: (options: TitleBarOverlayOptions) => void
}

declare global {
  interface Window {
    dscode?: HostApi
  }
}

export const host: HostApi | undefined =
  typeof window === 'undefined' ? undefined : window.dscode

export const isMac = host?.platform === 'darwin'

/** 是否处于无边框窗口环境（Electron），决定拖拽区与标题栏悬浮控件的占位 */
export const isFrameless = host !== undefined

/** Windows 原生悬浮按钮占用 header 右侧的宽度（3 个按钮，每个约 46px） */
export const TITLEBAR_OVERLAY_WIDTH = 150
