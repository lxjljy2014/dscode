import { statSync } from 'node:fs';
import { app } from 'electron';
import type { BrowserWindow } from 'electron';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import type { TerminalEnsureResult } from '@dscode/shared';

/**
 * 集成终端会话管理（node-pty）：一个窗口可开多个终端（标签页），
 * 会话按渲染端生成的 sessionId 索引，另记窗口归属用于统一回收。
 * 数据/退出事件经 win.webContents.send 推给渲染端（带 sessionId）；
 * 输入/尺寸/关闭由 IPC 驱动，窗口关闭或应用退出时统一回收。
 */

const sessions = new Map<string, IPty>();
const windowSessions = new Map<number, Set<string>>();

function track(wcId: number, sessionId: string): void {
  let set = windowSessions.get(wcId);
  if (!set) windowSessions.set(wcId, (set = new Set()));
  set.add(sessionId);
  set.add(sessionId);
}

function untrack(wcId: number, sessionId: string): void {
  windowSessions.get(wcId)?.delete(sessionId);
}

/** shell 启动参数：Unix 用 $SHELL + 登录壳参数，Windows 用 %COMSPEC% */
function shellSpec(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return { file: process.env['COMSPEC'] || 'cmd.exe', args: [] };
  }
  const file = process.env['SHELL'] || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  return { file, args: ['-l'] }; // 登录 shell：加载用户环境（PATH、别名等）
}

/** cwd 必须是存在的目录，否则回退家目录 */
function resolveCwd(cwd: string): string {
  try {
    if (statSync(cwd).isDirectory()) return cwd;
  } catch {
    // 路径不存在或无权限，回退
  }
  return app.getPath('home');
}

/** 确保指定 sessionId 的会话存在（已存在则复用并返回 pid） */
export function ensureTerminal(win: BrowserWindow, sessionId: string, cwd: string): TerminalEnsureResult {
  const existing = sessions.get(sessionId);
  if (existing) return { ok: true, sessionId, pid: existing.pid };
  try {
    const { file, args } = shellSpec();
    const wcId = win.webContents.id;
    const term = pty.spawn(file, args, {
      name: 'xterm-256color',
      cwd: resolveCwd(cwd),
      env: { ...process.env, TERM: 'xterm-256color' }
    });
    term.onData(data => {
      if (!win.isDestroyed()) win.webContents.send('terminal:data', { sessionId, data });
    });
    term.onExit(({ exitCode }) => {
      sessions.delete(sessionId);
      untrack(wcId, sessionId);
      if (!win.isDestroyed()) win.webContents.send('terminal:exit', { sessionId, exitCode });
    });
    sessions.set(sessionId, term);
    track(wcId, sessionId);
    return { ok: true, sessionId, pid: term.pid };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 写入用户输入（pty 已退出时忽略） */
export function writeTerminal(_win: BrowserWindow, sessionId: string, data: string): void {
  const term = sessions.get(sessionId);
  if (!term) return;
  try {
    term.write(data);
  } catch {
    // pty 已关闭
  }
}

/** 同步渲染端尺寸（cols/rows） */
export function resizeTerminal(_win: BrowserWindow, sessionId: string, cols: number, rows: number): void {
  const term = sessions.get(sessionId);
  if (!term) return;
  try {
    term.resize(cols, rows);
  } catch {
    // pty 已关闭
  }
}

/** 关闭单个会话（渲染端关闭标签页时调用） */
export function killTerminal(win: BrowserWindow, sessionId: string): void {
  const term = sessions.get(sessionId);
  if (!term) return;
  sessions.delete(sessionId);
  untrack(win.webContents.id, sessionId);
  try {
    term.kill();
  } catch {
    // 已退出
  }
}

/** 窗口关闭时回收该窗口的全部会话 */
/** 窗口关闭时回收该窗口的全部会话（wcId 须在窗口销毁前捕获；closed 事件里访问 win.webContents 会抛 Object has been destroyed） */
export function killWindowTerminals(wcId: number): void {
  const ids = windowSessions.get(wcId);
  if (!ids) return;
  for (const sessionId of new Set(ids)) {
    const term = sessions.get(sessionId);
    if (!term) continue;
    sessions.delete(sessionId);
    untrack(wcId, sessionId);
    try {
      term.kill();
    } catch {
      // 已退出
    }
  }
}

/** 应用退出时回收全部会话 */
export function disposeTerminals(): void {
  for (const term of sessions.values()) {
    try {
      term.kill();
    } catch {
      // 已退出
    }
  }
  sessions.clear();
  windowSessions.clear();
}