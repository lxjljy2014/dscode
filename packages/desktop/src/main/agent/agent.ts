import { app, BrowserWindow } from 'electron';
import {
  disposeAgents,
  loadSettings,
  resolveConfirm,
  startAgent as startAgentCore,
  stopAgent as stopAgentCore
} from '@dscode/core';
import type { AgentEventSink } from '@dscode/core';

/**
 * agent 的 Electron 壳：把 core 的 AgentEventSink 适配到 IPC 事件推送。
 * 运行时逻辑（LLM 流式 + 工具循环 + 门控）在 @dscode/core，将来 TUI 端复用同一运行时、自实现 sink。
 */

/** 把 core 的 AgentEventSink 适配到 IPC 通道（通道名是壳的细节，不进 core） */
function createSink(win: BrowserWindow): AgentEventSink {
  const send = (channel: string, payload: unknown): void => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };
  return {
    delta: (sessionId, kind, content) => send('agent:delta', { sessionId, content, kind }),
    tool: (sessionId, event) => send('agent:tool', { sessionId, event }),
    confirm: (sessionId, toolEventId, name, args) => send('agent:confirm', { sessionId, toolEventId, name, args }),
    done: sessionId => send('agent:done', { sessionId }),
    error: (sessionId, code, detail) => send('agent:error', { sessionId, code, ...(detail ? { detail } : {}) }),
    diff: (sessionId, files) => send('workspace:diff', { sessionId, files })
  };
}

/** 启动一次 agent 运行（渲染端经 agent:start invoke 调用） */
export function startAgent(
  win: BrowserWindow,
  sessionId: string,
  model: unknown,
  rawMessages: unknown
): { ok: true } | { ok: false; error: string } {
  const settings = loadSettings(app.getPath('userData') + '/settings.json', app.getPath('home'));
  return startAgentCore({
    sessionId,
    model,
    rawMessages,
    sink: createSink(win),
    config: {
      workingDirectory: settings.workingDirectory,
      permissionMode: settings.permissionMode,
      providers: settings.providers
    }
  });
}

/** 停止会话的 agent 运行 */
export function stopAgent(_win: BrowserWindow, sessionId: string): void {
  stopAgentCore(sessionId);
}

export { disposeAgents, resolveConfirm };
