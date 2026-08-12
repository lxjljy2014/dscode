/**
 * 权限模式（语义对齐参考项目的 configurable-gate）：
 * - confirm（变更前确认）：写/执行类工具发确认请求
 * - auto-edit（自动编辑）：写工具直接放行，执行（bash）仍需确认
 * - plan（计划模式）：写/执行一律拒绝，只读 + 出方案
 * - full-access（完全访问）：全部放行
 * 当前 mock 骨架只持久化该值，真实门控等接入 agent 后实现。
 */
export type PermissionMode = 'confirm' | 'auto-edit' | 'plan' | 'full-access';

export interface AppSettings {
  /** 工作目录（默认家目录） */
  workingDirectory: string;
  /** 权限模式（默认 confirm） */
  permissionMode: PermissionMode;
}

export type SettingsPatch = Partial<AppSettings>;
