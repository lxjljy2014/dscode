import type { AgentToolName, PermissionMode } from '@dscode/shared';
import { toolPermission } from '../tools';

/** 门控决策结果 */
export interface GateDecision {
  allow: boolean;
  /** 拒绝原因（plan 模式 / 用户拒绝 / 确认超时） */
  reason?: string;
}

/** 确认回调：由 agent 循环提供（发 agent:confirm 事件并等待渲染端响应） */
export type ConfirmFn = (toolEventId: string, name: AgentToolName, argsJson: string) => Promise<boolean>;

const CONFIRM_TIMEOUT_MS = 120_000;

/** 工具是否需要用户确认（只读与 full-access 全放行；plan 模式下写/执行无需确认直接被拒） */
export function needsConfirm(name: AgentToolName, mode: PermissionMode): boolean {
  const permission = toolPermission(name);
  if (permission === 'read' || mode === 'full-access') return false;
  if (mode === 'plan') return false;
  if (mode === 'auto-edit' && permission === 'write') return false;
  return true;
}

/**
 * 权限门控：按工具权限分类 + 权限模式决定放行 / 拒绝 / 需确认。
 * 确认等待 120s 超时自动拒绝，保证 agent 循环不会永久挂起。
 */
export async function gateTool(
  name: AgentToolName,
  mode: PermissionMode,
  toolEventId: string,
  argsJson: string,
  confirm: ConfirmFn
): Promise<GateDecision> {
  const permission = toolPermission(name);

  // 只读工具与完全访问模式直接放行
  if (permission === 'read' || mode === 'full-access') return { allow: true };

  // plan 模式：写/执行一律拒绝
  if (mode === 'plan') return { allow: false, reason: 'plan-mode' };

  // auto-edit：写放行，执行仍需确认；confirm：写/执行都确认
  if (mode === 'auto-edit' && permission === 'write') return { allow: true };

  // 确认等待 120s 超时自动拒绝（区分用户拒绝与超时，便于渲染端展示原因）
  let timedOut = false;
  const approved = await Promise.race([
    confirm(toolEventId, name, argsJson),
    new Promise<boolean>(resolve => {
      setTimeout(() => {
        timedOut = true;
        resolve(false);
      }, CONFIRM_TIMEOUT_MS);
    })
  ]);
  return approved ? { allow: true } : { allow: false, reason: timedOut ? 'timeout' : 'denied' };
}
