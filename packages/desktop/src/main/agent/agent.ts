import { app, BrowserWindow } from 'electron';
import {
  createSqliteLlmCache,
  disposeAgents,
  getSessionStats,
  recordUsage,
  resolveConfirm,
  skillCatalogSection,
  startAgent as startAgentCore,
  stopAgent as stopAgentCore,
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_EN
} from '@dscode/core';
import type { AppSettings, Hook } from '@dscode/shared';
import type { AgentEventSink, AgentStartResult, LlmCache } from '@dscode/core';
import { loadAppSettings } from '../settings';
import { getConfigDir, getDbFile, getSessionsDir } from '../data-dir';
import { isChatMessagePayload } from '../validators';
import { fireHooks } from '../hooks';

/**
 * agent 的 Electron 壳：把 core 的 AgentEventSink 适配到 IPC 事件推送。
 * 运行时逻辑（LLM 流式 + 工具循环 + 门控）在 @dscode/core，将来 TUI 端复用同一运行时、自实现 sink。
 * IPC 边界在此完成 model / messages 的类型收窄（公共边界强类型化，core 不再依赖运行时过滤）。
 */

/** 运行发起窗口归属（事件只推给发起窗口；窗口关闭时回收其运行，避免孤儿运行烧 token） */
const winBySession = new Map<string, BrowserWindow>();

/** LLM 回复缓存（~/.dscode/db/cache.db，懒初始化；命中时重放响应省 token） */
let llmCache: LlmCache | null = null;
function getLlmCache(): LlmCache {
  if (!llmCache) llmCache = createSqliteLlmCache(getDbFile());
  return llmCache;
}

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
      // 用量同时推给渲染端（回复底部统计：首token/token 速率等），与 usage.db 落库并行
      send('agent:usage', { sessionId, usage });
      recordUsage(usageFile, {
        sessionId,
        model,
        promptTokens: usage.promptTokens,
        cachedPromptTokens: usage.cachedPromptTokens,
        completionTokens: usage.completionTokens,
        createdAt: Date.now()
      });
    },
    done: sessionId => {
      send('agent:done', { sessionId });
      fireHooks(hooks, 'session_end', cwd);
      winBySession.delete(sessionId); // 运行结束清理窗口归属，防无界增长
    },
    sessionStats: (sessionId, stats) => send('agent:session-stats', { sessionId, stats }),
    context: (sessionId, projection) => send('agent:context', { sessionId, ...projection }),
    error: (sessionId, code, detail) => {
      send('agent:error', { sessionId, code, ...(detail ? { detail } : {}) });
      fireHooks(hooks, 'session_end', cwd);
      winBySession.delete(sessionId); // 运行结束清理窗口归属，防无界增长
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
  subagentId: unknown,
  reasoningEffort: unknown
): Promise<AgentStartResult> {
  if (typeof model !== 'string') return { ok: false, error: 'invalid-args' };
  if (subagentId !== undefined && typeof subagentId !== 'string') {
    return { ok: false, error: 'invalid-args' };
  }
  if (reasoningEffort !== undefined && reasoningEffort !== 'off' && reasoningEffort !== 'high' && reasoningEffort !== 'max') {
    return { ok: false, error: 'invalid-args' };
  }
  if (!Array.isArray(rawMessages) || !rawMessages.every(isChatMessagePayload)) {
    return { ok: false, error: 'invalid-args' };
  }
  const settings = loadAppSettings(getConfigDir(), app.getPath('home'));
  // 会话开始钩子
  fireHooks(settings.hooks, 'session_start', settings.workingDirectory);
  const result = await startAgentCore({
    sessionId,
    model,
    rawMessages,
    // 重启后回灌持久化的会话统计（含上下文占用 contextTokens），避免累计值被清零
    initialStats: getSessionStats(getSessionsDir(), sessionId),
    sink: createSink(win, settings.hooks, settings.workingDirectory, model, getDbFile()),
    config: {
      workingDirectory: settings.workingDirectory,
      // 启动快照兜底；动态 source 让运行中切换权限模式对下一轮工具调用立即生效
      permissionMode: settings.permissionMode,
      // 每次工具轮询前重读最新 settings.json：输入卡片切换权限模式 → 主进程落盘 → 此处取到新值
      permissionModeSource: () =>
        loadAppSettings(getConfigDir(), app.getPath('home')).permissionMode,
      providers: settings.providers,
      systemPrompt: buildAgentSystemPrompt(settings, subagentId),
      browsingEnabled: settings.browsingEnabled,
      skills: settings.skills,
      llmCache: getLlmCache(),
      // 渲染端「推理强度」选择器：显式值时覆盖 provider 默认；undefined（auto）跟随 provider
      ...(reasoningEffort !== undefined ? { reasoningEffort: reasoningEffort as 'off' | 'high' | 'max' } : {})
    }
  });
  if (result.ok) winBySession.set(sessionId, win);
  return result;
}

/**
 * 组装 agent 系统提示词：默认提示词跟随系统语言（子智能体人设替换基底）+ 长期记忆 + 技能目录注入。
 * compact 等无运行场景复用同一组装，保证上下文占用估算与真实运行同口径。
 */
export function buildAgentSystemPrompt(settings: AppSettings, subagentId?: string): string {
  const subagent = subagentId ? settings.subagents.find(s => s.id === subagentId) : undefined;
  const basePrompt = subagent
    ? subagent.systemPrompt
    : app.getLocale().toLowerCase().startsWith('zh')
      ? SYSTEM_PROMPT
      : SYSTEM_PROMPT_EN;
  // 长期记忆（对应列表为空时保持默认提示词不变）
  const memorySection =
    settings.memory.length > 0
      ? '\n\n用户长期记忆（回答时优先参考，若与当前任务无关可忽略）：\n' +
        settings.memory.map((m, i) => `${i + 1}. ${m.content}`).join('\n')
      : '';
  // 技能只注入目录（名称 + 一句话说明），模型判断任务相关时先调用 skill 工具加载完整指令再执行
  // （借鉴官方 harness：目录进提示词 + 按需加载正文，避免全量指令占上下文）
  return basePrompt + memorySection + skillCatalogSection(settings.skills);
}

/** 停止会话的 agent 运行 */
export function stopAgent(_win: BrowserWindow, sessionId: string): void {
  stopAgentCore(sessionId);
}

/** 窗口关闭时中止其发起的所有运行（事件推给已销毁窗口无意义，且避免孤儿运行继续烧 token） */
export function stopWindowAgents(win: BrowserWindow): void {
  for (const [sessionId, owner] of winBySession) {
    if (owner === win) {
      stopAgentCore(sessionId);
      winBySession.delete(sessionId);
    }
  }
}

export { disposeAgents, resolveConfirm };