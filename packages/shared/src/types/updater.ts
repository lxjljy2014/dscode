/** 自动更新状态机（主进程 → 渲染端，驱动侧边栏更新按钮） */
export type UpdaterState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'not-available' }
  | { state: 'error'; message: string };
