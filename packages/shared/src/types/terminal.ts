/** 终端会话 ensure 结果（成功返回 shell pid；sessionId 由渲染端生成，主进程按 id 管理多会话） */
export type TerminalEnsureResult =
  | { ok: true; sessionId: string; pid: number }
  | { ok: false; error: string };

/** 终端输出数据事件（按 sessionId 分发） */
export interface TerminalDataEvent {
  sessionId: string;
  data: string;
}

/** 终端进程退出事件（按 sessionId 分发） */
export interface TerminalExitInfo {
  sessionId: string;
  exitCode: number;
}
