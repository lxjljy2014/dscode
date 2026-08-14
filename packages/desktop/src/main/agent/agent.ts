import { app, BrowserWindow } from 'electron';
import type { AgentToolEvent, ChatMessagePayload, PermissionMode } from '@dscode/shared';
import {
  ApiError,
  clearSnapshot,
  executeTool,
  initSnapshot,
  loadSettings,
  recomputeDiff,
  resolveAdapter,
  streamChat,
  toolPermission,
  toolSchemas
} from '@dscode/core';
import { gateTool, needsConfirm } from './agent-gate';

/**
 * agent 运行时：主进程内执行「LLM 流式对话 + 工具循环」。
 * 会话按 sessionId 管理（Map），事件经 win.webContents.send 推给渲染端：
 * agent:delta / agent:tool / agent:confirm / agent:done / agent:error。
 * 配置（供应商/工作目录）由主进程读 settings.json，渲染端不可注入 baseUrl/key。
 */

const MAX_TOOL_ROUNDS = 30;
/** 单轮 LLM 请求最长等待（含流式全程） */
const ROUND_TIMEOUT_MS = 5 * 60_000;

interface RunState {
  controller: AbortController;
}

/** 进行中的 agent 运行（按 sessionId） */
const runs = new Map<string, RunState>();

/** 等待用户确认的工具调用：toolEventId → resolve */
const pendingConfirms = new Map<string, (approve: boolean) => void>();

let toolSeq = 0;
function nextToolId(): string {
  return `t-${Date.now()}-${toolSeq++}`;
}

function send(win: BrowserWindow, channel: string, payload: unknown): void {
  if (!win.isDestroyed()) win.webContents.send(channel, payload);
}

const SYSTEM_PROMPT =
  '你是 DSCode 内置的编程助手，在用户的工作目录中工作。可以调用工具读取文件、列出目录、搜索代码、执行命令、写入或编辑文件。规则：\n' +
  '- 修改代码前先阅读相关文件，理解上下文\n' +
  '- 写文件/编辑/执行命令会经过系统权限门控，可能需要用户确认\n' +
  '- 工作目录内的路径一律使用相对路径\n' +
  '- 回答语言与用户提问一致\n' +
  '- 只做用户要求的事，不擅自扩大改动范围';

// ---- LLM 流式调用（协议适配在 @dscode/core adapters） ----

// ---- 工具事件推送 ----

function pushToolEvent(win: BrowserWindow, sessionId: string, event: AgentToolEvent): void {
  send(win, 'agent:tool', { sessionId, event });
}

// ---- agent 循环 ----

async function runLoop(
  win: BrowserWindow,
  sessionId: string,
  cwd: string,
  permissionMode: PermissionMode,
  provider: { baseUrl: string; apiKey: string; adapter?: string },
  model: string,
  messages: unknown[]
): Promise<void> {
  const run = runs.get(sessionId);
  if (!run) return;
  const signal = run.controller.signal;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const combined = AbortSignal.any([signal, AbortSignal.timeout(ROUND_TIMEOUT_MS)]);
      const toolCalls = await streamChat(
        resolveAdapter(provider.adapter),
        { baseUrl: provider.baseUrl, apiKey: provider.apiKey, model, messages, tools: toolSchemas() },
        combined,
        text => send(win, 'agent:delta', { sessionId, content: text, kind: 'content' }),
        text => send(win, 'agent:delta', { sessionId, content: text, kind: 'reasoning' })
      );
      if (toolCalls.length === 0) {
        send(win, 'agent:done', { sessionId });
        return;
      }

      // 本轮 assistant 消息（含文本与工具调用）入上下文
      messages.push({
        role: 'assistant',
        content: '',
        tool_calls: toolCalls.map(t => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: t.arguments }
        }))
      });

      // 逐个执行工具：门控 → 执行 → 结果入上下文
      for (const t of toolCalls) {
        if (signal.aborted) return;
        const toolEventId = nextToolId();
        const event: AgentToolEvent = {
          id: toolEventId,
          name: t.name,
          args: t.arguments,
          status: needsConfirm(t.name, permissionMode) ? 'confirming' : 'running',
          createdAt: Date.now()
        };
        pushToolEvent(win, sessionId, event);

        let toolResultContent: string;
        if (needsConfirm(t.name, permissionMode)) {
          const decision = await gateTool(t.name, permissionMode, toolEventId, t.arguments, (id, name, argsJson) =>
            new Promise<boolean>(resolve => {
              pendingConfirms.set(id, resolve);
              send(win, 'agent:confirm', { sessionId, toolEventId: id, name, args: argsJson });
            })
          );
          if (signal.aborted) return;
          if (!decision.allow) {
            pushToolEvent(win, sessionId, {
              ...event,
              status: 'denied',
              error: decision.reason === 'timeout' ? '确认超时' : decision.reason === 'plan-mode' ? 'plan 模式已拒绝' : '用户拒绝'
            });
            toolResultContent = `工具调用被拒绝：${decision.reason ?? 'denied'}`;
            messages.push({ role: 'tool', tool_call_id: t.id, content: toolResultContent });
            continue;
          }
          pushToolEvent(win, sessionId, { ...event, status: 'running' });
        }

        const result = await executeTool(t.name, t.arguments, cwd);
        if (result.ok) {
          pushToolEvent(win, sessionId, { ...event, status: 'done', summary: result.content.slice(0, 200) });
          toolResultContent = result.content;
          // 写/执行成功后重算快照 diff 并推送
          if (toolPermission(t.name) !== 'read') {
            send(win, 'workspace:diff', { sessionId, files: recomputeDiff(sessionId, cwd) });
          }
        } else {
          pushToolEvent(win, sessionId, { ...event, status: 'error', error: result.error });
          toolResultContent = `执行失败：${result.error}`;
        }
        messages.push({ role: 'tool', tool_call_id: t.id, content: toolResultContent });
      }
    }
    send(win, 'agent:done', { sessionId });
  } catch (e) {
    if (signal.aborted) {
      send(win, 'agent:error', { sessionId, code: 'aborted' });
      return;
    }
    if (e instanceof ApiError) {
      send(win, 'agent:error', { sessionId, code: 'api', detail: `HTTP ${e.status} ${e.message}` });
    } else if (e instanceof Error && e.name === 'TimeoutError') {
      send(win, 'agent:error', { sessionId, code: 'network', detail: '请求超时' });
    } else {
      send(win, 'agent:error', {
        sessionId,
        code: 'network',
        detail: e instanceof Error ? e.message : String(e)
      });
    }
  }
}

// ---- 对外接口 ----

/** 启动一次 agent 运行（渲染端经 agent:start invoke 调用） */
export function startAgent(
  win: BrowserWindow,
  sessionId: string,
  model: unknown,
  rawMessages: unknown
): { ok: true } | { ok: false; error: string } {
  if (runs.has(sessionId)) return { ok: false, error: 'session already running' };
  // 校验消息列表
  if (!Array.isArray(rawMessages)) return { ok: false, error: 'invalid messages' };
  const messages: ChatMessagePayload[] = rawMessages.filter(
    (m): m is ChatMessagePayload =>
      typeof m === 'object' &&
      m !== null &&
      ((m as Record<string, unknown>)['role'] === 'user' || (m as Record<string, unknown>)['role'] === 'assistant') &&
      typeof (m as Record<string, unknown>)['content'] === 'string'
  );
  if (messages.length === 0) return { ok: false, error: 'empty messages' };

  const settings = loadSettings(app.getPath('userData') + '/settings.json', app.getPath('home'));
  const provider = settings.providers[0];
  if (!provider || provider.apiKey.length === 0) {
    send(win, 'agent:error', { sessionId, code: 'no-api-key' });
    return { ok: true };
  }
  const requestedModel = typeof model === 'string' ? model : '';
  const resolvedModel = provider.models.includes(requestedModel) ? requestedModel : (provider.models[0] ?? '');
  if (resolvedModel.length === 0) return { ok: false, error: 'no models configured' };

  const controller = new AbortController();
  runs.set(sessionId, { controller });
  // agent 启动时快照工作目录，作为本次运行 diff 的基线
  initSnapshot(sessionId, settings.workingDirectory);

  const context = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages.map(m => ({ role: m.role, content: m.content }))
  ];

  runLoop(
    win,
    sessionId,
    settings.workingDirectory,
    settings.permissionMode,
    { baseUrl: provider.baseUrl, apiKey: provider.apiKey, adapter: provider.adapter },
    resolvedModel,
    context
  ).finally(() => {
    runs.delete(sessionId);
    clearSnapshot(sessionId);
    // 运行结束未处理的确认一律视为拒绝，避免残留挂起
    for (const [id, resolve] of pendingConfirms) {
      resolve(false);
      pendingConfirms.delete(id);
    }
  });
  return { ok: true };
}

/** 停止会话的 agent 运行（abort 后 runLoop 会推 agent:error aborted 收尾） */
export function stopAgent(_win: BrowserWindow, sessionId: string): void {
  runs.get(sessionId)?.controller.abort();
  // 解除确认等待（gateTool 收到拒绝后循环随 abort 退出）
  for (const [id, resolve] of pendingConfirms) {
    resolve(false);
    pendingConfirms.delete(id);
  }
}

/** 渲染端确认响应入口（agent:confirm-response） */
export function resolveConfirm(toolEventId: unknown, approve: unknown): void {
  if (typeof toolEventId !== 'string' || typeof approve !== 'boolean') return;
  const resolve = pendingConfirms.get(toolEventId);
  if (resolve) {
    pendingConfirms.delete(toolEventId);
    resolve(approve);
  }
}

/** 应用退出前中止全部 agent 运行 */
export function disposeAgents(): void {
  for (const run of runs.values()) run.controller.abort();
  runs.clear();
  for (const [id, resolve] of pendingConfirms) {
    resolve(false);
    pendingConfirms.delete(id);
  }
}
