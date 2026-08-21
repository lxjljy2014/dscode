import type { AgentToolEvent, ConfirmDecision, PermissionMode, Skill } from '@dscode/shared';
import { gateTool, needsConfirm } from '../gate/gate';
import { approvalSignature, executeTool, toolConcurrencyOf, toolPermission } from '../tools';
import type { Tool, ToolResult } from '../tools';
import type { AgentEventSink } from './types';

/** 同轮内并行工具调用的最大并发数（借鉴官方 harness agent-loop 的 maxParallelToolCalls 滚动池） */
export const MAX_PARALLEL_TOOL_CALLS = 4;

/** 调度器所需的运行时状态（由 AgentRuntime 注入；独立成模块便于单测调度逻辑） */
export interface ToolBatchRuntime {
  /** 生成工具事件 id（运行时自增序列） */
  nextToolId(): string;
  /** 累计工具耗时统计（毫秒） */
  addToolMs(sessionId: string, ms: number): void;
  /** 会话免问集合（allow-session 记忆） */
  sessionApprovals: Map<string, Set<string>>;
  /** 待确认注册表：gateTool 确认回调中登记，供渲染端确认响应 */
  pendingConfirms: Map<string, { sessionId: string; resolve: (decision: ConfirmDecision) => void }>;
  /** 中止整个运行的控制器（用户拒绝时触发） */
  abortRun(sessionId: string): void;
  /** 写/执行成功后重算快照 diff 并推送 */
  recomputeDiff(sessionId: string, cwd: string, changedPaths?: string[]): Promise<void>;
  /** 工具结果上下文预算（跨轮累计；插入时按 remaining 截断，保证 steps 落库与运行时上下文逐字节一致）；缺省不截断 */
  toolBudget?: { remaining: number };
  /** 本次运行可用的技能列表（透传给 skill 工具） */
  skills: Skill[];
  /** 动态注入工具（MCP）查表：内置注册表未命中时回退到此 */
  extraTools?: Map<string, Tool>;
  /**
   * 工具集白名单（子任务运行时注入）：模型调用了未暴露的工具 → 结构化错误结果
   * （不中止运行，模型可自行纠正）；缺省不限制。task 始终不在子任务白名单内（防递归委派）。
   */
  allowedTools?: Set<string>;
  /** 子任务派发实现（task 工具用，运行时注入） */
  spawnSubagent?: import('../tools/types').ToolContext['spawnSubagent'];
}

/** 一轮工具调度的结果：continueLoop=false 表示中止/用户拒绝（调用方应退出 runLoop）；concluded 表示某工具标记本轮结束 */
export interface ToolBatchOutcome {
  continueLoop: boolean;
  concluded: boolean;
}

/**
 * 调度一轮工具调用：门控阶段串行（确认卡片一次只能显示一个），执行阶段按并发分类调度——
 * parallel 工具成组并行（滚动池，上限 MAX_PARALLEL_TOOL_CALLS），exclusive 工具单独执行形成屏障；
 * 结果一律按模型调用顺序提交（事件 + 上下文），保证渲染端 steps 落库顺序与运行时上下文一致（前缀缓存稳定）。
 * 借鉴官方 harness agent-loop/tool-calls 的「并行池 + 独占 barrier + 模型顺序提交」设计。
 * 门控统一走 gateTool：read/full-access 放行、plan 拒绝、confirm/auto-edit 按模式确认（needsConfirm 仅决定初始事件状态，
 * 不再作为「是否调用 gateTool」的分支——原实现的 plan 模式会因此绕过拒绝直接执行，属缺陷，此处顺带修复）。
 * 结果结构化消费（借鉴 harness ToolExecutionResult）：blocks/meta 透传 UI 事件、additionalContexts 注入下一步上下文、
 * concludesTurn 标记本轮结束（concluded=true，调用方在后续轮询时不再回模型）。
 */
export async function executeToolBatch(
  sessionId: string,
  permissionMode: PermissionMode,
  toolCalls: { id: string; name: string; arguments: string }[],
  messages: unknown[],
  cwd: string,
  signal: AbortSignal,
  sink: AgentEventSink,
  rt: ToolBatchRuntime
): Promise<ToolBatchOutcome> {
  // ---- 门控阶段（串行）：统一 gateTool 决策（放行/拒绝/确认），拒绝停止整个任务 ----
  interface Planned {
    call: { id: string; name: string; arguments: string };
    toolEventId: string;
    event: AgentToolEvent;
  }
  const planned: Planned[] = [];
  for (const call of toolCalls) {
    if (signal.aborted) return { continueLoop: false, concluded: false };
    const toolEventId = rt.nextToolId();
    // 白名单外工具（子任务运行）：不门控不执行，直接按模型顺序回错误结果，模型可纠正后重试
    if (rt.allowedTools && !rt.allowedTools.has(call.name)) {
      sink.tool(sessionId, {
        id: toolEventId,
        toolCallId: call.id,
        name: call.name,
        args: call.arguments,
        status: 'error',
        error: '该工具在当前任务中不可用',
        createdAt: Date.now()
      });
      messages.push({ role: 'tool', tool_call_id: call.id, content: '错误：该工具在当前任务中不可用' });
      continue;
    }
    const event: AgentToolEvent = {
      id: toolEventId,
      // 模型 tool call id：渲染端历史重建时靠它对齐运行时上下文，保持前缀缓存稳定
      toolCallId: call.id,
      name: call.name,
      args: call.arguments,
      status: needsConfirm(call.name, permissionMode) ? 'confirming' : 'running',
      createdAt: Date.now()
    };
    sink.tool(sessionId, event);
    // 会话记忆（allow-session）命中：直接放行，不再询问
    const signature = approvalSignature(call.name, call.arguments);
    let decision: ConfirmDecision | undefined;
    if (!rt.sessionApprovals.get(sessionId)?.has(signature)) {
      const gate = await gateTool(
        call.name,
        permissionMode,
        toolEventId,
        call.arguments,
        (id, name, argsJson) =>
          new Promise<ConfirmDecision>(resolve => {
            rt.pendingConfirms.set(id, { sessionId, resolve });
            sink.confirm(sessionId, id, name, argsJson);
          })
      );
      if (signal.aborted) return { continueLoop: false, concluded: false };
      decision = gate.decision ?? (gate.allow ? { kind: 'allow-once' } : { kind: 'deny' });
      // 记录用户选择：本会话免问
      if (decision.kind === 'allow-session') {
        if (!rt.sessionApprovals.has(sessionId)) rt.sessionApprovals.set(sessionId, new Set());
        rt.sessionApprovals.get(sessionId)!.add(signature);
      }
      if (!gate.allow) {
        sink.tool(sessionId, {
          ...event,
          status: 'denied',
          error:
            gate.reason === 'timeout'
              ? '确认超时'
              : gate.reason === 'plan-mode'
                ? 'plan 模式已拒绝'
                : '用户拒绝'
        });
        // 用户拒绝：停止整个任务（等同用户点了停止；runLoop 直接退出）
        rt.abortRun(sessionId);
        sink.error(sessionId, 'aborted');
        return { continueLoop: false, concluded: false };
      }
    }
    // 确认放行或免问：进入执行（confirming → running 事件流转）
    sink.tool(sessionId, { ...event, status: 'running' });
    planned.push({ call, toolEventId, event });
  }

  // ---- 执行阶段：并行滚动池 + 独占屏障，结果按模型顺序提交 ----
  const budget = rt.toolBudget ?? { remaining: Number.POSITIVE_INFINITY };
  const results: Array<{ result: ToolResult; toolMs: number } | undefined> = planned.map(() => undefined);
  let cursor = 0;
  let concluded = false;
  while (cursor < planned.length) {
    if (signal.aborted) return { continueLoop: false, concluded };
    // 收集从 cursor 起的一段：parallel 连续段（上限 MAX_PARALLEL_TOOL_CALLS），或一个 exclusive 工具
    const isExclusive = toolConcurrencyOf(planned[cursor]!.call.name) === 'exclusive';
    let effectiveEnd: number;
    if (isExclusive) {
      effectiveEnd = cursor + 1;
    } else {
      effectiveEnd = Math.min(cursor + MAX_PARALLEL_TOOL_CALLS, planned.length);
      // 并行段内遇到 exclusive 提前收组，交给下一轮 barrier
      for (let i = cursor; i < effectiveEnd; i++) {
        if (toolConcurrencyOf(planned[i]!.call.name) === 'exclusive') { effectiveEnd = i; break; }
      }
    }
    if (effectiveEnd === cursor) { cursor++; continue; }
    const slice = planned.slice(cursor, effectiveEnd);
    // 并行执行组内工具（exclusive 组长度为 1，天然串行）
    await Promise.all(slice.map(async (p, idx) => {
      const absIdx = cursor + idx;
      const toolStart = Date.now();
      const result = await executeTool(p.call.name, p.call.arguments, cwd, {
        signal,
        skills: rt.skills,
        extraTools: rt.extraTools,
        spawnSubagent: rt.spawnSubagent
      });
      results[absIdx] = { result, toolMs: Date.now() - toolStart };
    }));
    // 模型顺序提交：done/error 事件 + diff + 上下文，顺序与 planned 一致
    for (let i = cursor; i < effectiveEnd; i++) {
      const p = planned[i]!;
      const settled = results[i]!;
      rt.addToolMs(sessionId, settled.toolMs);
      if (settled.result.ok) {
        // 上下文预算：在插入时按剩余预算截断，且「存进 steps 的 content」与「注入上下文的 content」用同一份截断值，
        // 跨运行历史重建仍逐字节一致（前缀缓存稳定），并把最坏情况的工具输出总量封顶在预算内。
        let content = settled.result.content;
        if (content.length > budget.remaining) {
          content = content.slice(0, budget.remaining) + '\n…（上下文预算已满，已截断）';
          budget.remaining = 0;
        } else {
          budget.remaining -= content.length;
        }
        const doneEvent: AgentToolEvent = {
          ...p.event,
          status: 'done',
          summary: settled.result.content.slice(0, 200),
          content,
          ...(settled.result.blocks !== undefined ? { blocks: settled.result.blocks } : {}),
          ...(settled.result.meta !== undefined ? { meta: settled.result.meta } : {}),
          ...(settled.result.additionalContexts !== undefined ? { additionalContexts: settled.result.additionalContexts } : {})
        };
        sink.tool(sessionId, doneEvent);
        messages.push({ role: 'tool', tool_call_id: p.call.id, content });
        // 附加上下文：注入为 user 消息，供下一步模型使用（渲染端事件已透传，落库后可重建对齐）
        for (const ctx of settled.result.additionalContexts ?? []) {
          messages.push({ role: 'user', content: ctx });
        }
        // 写/执行成功后重算快照 diff 并推送（写/编辑按变更路径增量，run_command 退化为全量）
        if (toolPermission(p.call.name) !== 'read') {
          await rt.recomputeDiff(sessionId, cwd, settled.result.changedPaths);
        }
        if (settled.result.concludesTurn === true) concluded = true;
      } else {
        sink.tool(sessionId, { ...p.event, status: 'error', error: settled.result.error, ...(settled.result.meta !== undefined ? { meta: settled.result.meta } : {}) });
        messages.push({ role: 'tool', tool_call_id: p.call.id, content: '执行失败：' + settled.result.error });
      }
    }
    cursor = effectiveEnd;
  }
  return { continueLoop: true, concluded };
}