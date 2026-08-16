/** 系统托盘菜单动作（主进程托盘菜单 → 渲染端执行；先恢复窗口再分发） */
export type TrayAction =
  | { action: 'new-session' }
  | { action: 'open-settings'; section: string }
  | { action: 'open-workspace'; workspace: string };
