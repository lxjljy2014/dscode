/**
 * 工具执行管线（借鉴官方 harness tools/index.ts 的 pre → guard → execute → post → finalize → result 六段设计，轻量版）。
 * 宿主/插件可在执行前注册钩子：审批（pre）、守卫（guard）、around 包装（超时/重试/指标）、结果改写（post）、观察（onResult）；
 * 工具自身可声明 finalizeContent（最后内容变换）。DSCode 无插件容器，用「注册表 + 钩子数组」实现同等扩展点。
 */

import type { AgentToolName } from '@dscode/shared';
import type { ToolResult } from './types';

/** 一次工具执行的上下文（管线各段共享） */
export interface ToolExecution {
  name: AgentToolName;
  /** 已解析的参数对象（执行前统一校验通过） */
  args: Record<string, unknown>;
  /** 工作目录 */
  cwd: string;
  /** 调用方取消信号 */
  signal?: AbortSignal;
}

/**
 * 管线钩子集合：全部可选，注册后对后续所有工具调用生效（可同时注册多个，按注册顺序执行）。
 * - pre：执行前异步审批；返回 { error } 拒绝该调用（不进 guard/execute）。
 * - guard：同步守卫；返回字符串拒绝（原因给模型/UI）。
 * - around：包裹执行（如超时/重试/指标）；必须调用 next() 放行，next 返回工具真实结果。
 * - post：执行后改写结果（如统一截断、追加元数据）。
 * - onResult：只读观察（如审计日志），抛错被包含不影响主流程。
 */
export interface ToolPipelineHooks {
  pre?(exec: ToolExecution): Promise<{ error: string } | void>;
  guard?(exec: ToolExecution): string | undefined;
  around?(exec: ToolExecution, next: () => Promise<ToolResult>): Promise<ToolResult>;
  post?(exec: ToolExecution, result: ToolResult): Promise<ToolResult>;
  onResult?(exec: ToolExecution, result: ToolResult): void;
}

/** 管线注册表（模块级单例；宿主启动时注册，进程内共享） */
const hooks: ToolPipelineHooks[] = [];

/** 注册一组管线钩子；返回注销函数（宿主卸载时调用） */
export function registerToolHooks(added: ToolPipelineHooks): () => void {
  hooks.push(added);
  return () => {
    const i = hooks.indexOf(added);
    if (i >= 0) hooks.splice(i, 1);
  };
}

/** 执行一组钩子：依次执行，遇拒绝即短路 */
async function runPre(exec: ToolExecution): Promise<{ error: string } | undefined> {
  for (const h of hooks) {
    if (h.pre) {
      const r = await h.pre(exec);
      if (r && 'error' in r && r.error) return r;
    }
  }
  return undefined;
}

/** 守卫：任一返回字符串即拒绝（单调，注册顺序无关） */
function runGuard(exec: ToolExecution): string | undefined {
  for (const h of hooks) {
    const reason = h.guard?.(exec);
    if (reason) return reason;
  }
  return undefined;
}

/** 执行管线主入口：pre → guard → around(execute) → post → onResult */
export async function runToolPipeline(
  exec: ToolExecution,
  execute: () => Promise<ToolResult>,
): Promise<ToolResult> {
  // pre：异步审批，可拒绝
  const preResult = await runPre(exec);
  if (preResult) return { ok: false, error: preResult.error };
  // guard：同步守卫
  const guardReason = runGuard(exec);
  if (guardReason) return { ok: false, error: guardReason };
  // around：从内向外组合（后注册的在外层），next 最终调用工具本体
  let finalResult: ToolResult;
  const buildNext = (index: number): () => Promise<ToolResult> => {
    const h = hooks[index];
    if (!h?.around) return execute;
    const next = buildNext(index + 1);
    return () => h.around!(exec, next);
  };
  finalResult = await buildNext(0)();
  // post：结果改写（从内向外，后注册的先看到原始结果）
  for (let i = hooks.length - 1; i >= 0; i--) {
    if (hooks[i]?.post) finalResult = await hooks[i]!.post!(exec, finalResult);
  }
  // onResult：只读观察，包含异常
  for (const h of hooks) {
    try {
      h.onResult?.(exec, finalResult);
    } catch {
      // 观察者失败不影响主流程
    }
  }
  return finalResult;
}
