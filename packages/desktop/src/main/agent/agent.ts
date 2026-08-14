import { app, BrowserWindow } from 'electron';
import {
  disposeAgents,
  recordUsage,
  resolveConfirm,
  startAgent as startAgentCore,
  stopAgent as stopAgentCore,
  SYSTEM_PROMPT
} from '@dscode/core';
import type { Hook } from '@dscode/shared';
import type { AgentEventSink, AgentStartResult } from '@dscode/core';
import { loadAppSettings } from '../settings';
import { isChatMessagePayload } from '../validators';
import { fireHooks } from '../hooks';

/**
 * agent 的 Electron 壳：把 core 的 AgentEventSink 适配到 IPC 事件推送。
 * 运行时逻辑（LLM 流式 + 工具循环 + 门控）在 @dscode/core，将来 TUI 端复用同一运行时、自实现 sink。
 * IPC 边界在此完成 model / messages 的类型收窄（公共边界强类型化，core 不再依赖运行时过滤）。
 */

/** 把 core 的 AgentEventSink 适配到 IPC 通道（通道名是壳的细节，不进 core） */
function createSink(win: BrowserWindow, hooks: Hook[], cwd: string, model: string, usageFile: string): AgentEventSink {
  const send = (channel: string, payload: unknown): void => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };
  return {
    delta: (sessionId, kind, content) => send('agent:delta', { sessionId, content, kind }),
    tool: (sessionId, event) => {
      send('agent:tool', { sessionId, event });
      if (event.status === 'done') fireHooks(hooks, 'tool_done', cwd);
    },
    confirm: (sessionId, toolEventId, name, args) => send('agent:confirm', { sessionId, toolEventId, name, args }),
    usage: (sessionId, usage) => {
      recordUsage(usageFile, {
        sessionId,
        model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        createdAt: Date.now()
      });
    },
    done: sessionId => {
      send('agent:done', { sessionId });
      fireHooks(hooks, 'session_end', cwd);
    },
    error: (sessionId, code, detail) => {
      send('agent:error', { sessionId, code, ...(detail ? { detail } : {}) });
      fireHooks(hooks, 'session_end', cwd);
    },
    diff: (sessionId, files) => send('workspace:diff', { sessionId, files })
  };
}

/** 启动一次 agent 运行（渲染端经 agent:start invoke 调用） */
export async function startAgent(
  win: BrowserWindow,
  sessionId: string,
  model: unknown,
  rawMessages: unknown,
  subagentId: unknown
): Promise<AgentStartResult> {
  if (typeof model !== 'string') return { ok: false, error: 'invalid model' };
  if (subagentId !== undefined && typeof subagentId !== 'string') {
    return { ok: false, error: 'invalid subagent' };
  }
  if (!Array.isArray(rawMessages) || !rawMessages.every(isChatMessagePayload)) {
    return { ok: false, error: 'invalid messages' };
  }
  const settings = loadAppSettings(app.getPath('userData') + '/settings.json', app.getPath('home'));
  // 子智能体人设：命中则替换默认系统提示词，记忆/技能仍叠加
  const subagent = subagentId ? settings.subagents.find(s => s.id === subagentId) : undefined;
  const basePrompt = subagent ? subagent.systemPrompt : SYSTEM_PROMPT;
  // 长期记忆 + 技能注入系统提示词（对应列表为空时保持默认提示词不变）
  const memorySection =
    settings.memory.length > 0
      ? '\n\n用户长期记忆（回答时优先参考，若与当前任务无关可忽略）：\n' +
        settings.memory.map((m, i) => `${i + 1}. ${m.content}`).join('\n')
      : '';
  const skillSection =
    settings.skills.length > 0
      ? '\n\n可用技能（按需调用其说明执行）：\n' +
        settings.skills.map((s, i) => (i + 1) + '. ' + s.name + '：' + s.description + '\n' + s.instructions).join('\n')
      : '';
  // 会话开始钩子
  fireHooks(settings.hooks, 'session_start', settings.workingDirectory);
  return startAgentCore({
    sessionId,
    model,
    rawMessages,
    sink: createSink(win, settings.hooks, settings.workingDirectory, model, app.getPath('userData') + '/usage.db'),
    config: {
      workingDirectory: settings.workingDirectory,
      permissionMode: settings.permissionMode,
      providers: settings.providers,
      systemPrompt: basePrompt + memorySection + skillSection,
      browsingEnabled: settings.browsingEnabled
    }
  });
}

/** 停止会话的 agent 运行 */
export function stopAgent(_win: BrowserWindow, sessionId: string): void {
  stopAgentCore(sessionId);
}

export { disposeAgents, resolveConfirm };
