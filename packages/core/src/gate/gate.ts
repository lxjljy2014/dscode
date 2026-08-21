import type { AnyToolName, ConfirmDecision, PermissionMode } from '@dscode/shared';
import { toolPermission } from '../tools';

/** 门控决策结果 */
export interface GateDecision {
  allow: boolean;
  /** 拒绝原因（plan 模式 / 用户拒绝 / 确认超时） */
  reason?: 'plan-mode' | 'denied' | 'timeout';
  /** 用户决策（确认路径携带；deny/timeout 落在拒绝侧，由运行时停止任务） */
  decision?: ConfirmDecision;
}

/** 确认回调：由 agent 循环提供（发 agent:confirm 事件并等待渲染端响应） */
export type ConfirmFn = (toolEventId: string, name: AnyToolName, argsJson: string) => Promise<ConfirmDecision>;

const CONFIRM_TIMEOUT_MS = 120_000;

/** 工具是否需要用户确认（只读与 full-access 全放行；plan 模式下写/执行无需确认直接被拒） */
export function needsConfirm(name: string, mode: PermissionMode): boolean {
  const permission = toolPermission(name);
  if (permission === 'read' || mode === 'full-access') return false;
  if (mode === 'plan') return false;
  if (mode === 'auto-edit' && permission === 'write') return false;
  return true;
}

/** 确认决策结构收窄：kind 必须在合法集合内（allow-session 无需负载，签名由运行时按工具参数推导） */
export function isConfirmDecision(v: unknown): v is ConfirmDecision {
  if (typeof v !== 'object' || v === null) return false;
  const kind = (v as Record<string, unknown>)['kind'];
  return kind === 'allow-once' || kind === 'allow-session' || kind === 'deny';
}

/**
 * 权限门控：按工具权限分类 + 权限模式决定放行 / 拒绝 / 需确认。
 * 确认卡片由宿主实现，提供三选项（允许一次/本会话/拒绝）；拒绝由运行时停止整个任务；
 * 等待 120s 超时自动拒绝，保证 agent 循环不会永久挂起。
 */
export async function gateTool(
  name: string,
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
  let timer: ReturnType<typeof setTimeout> | undefined;
  const decision = await Promise.race([
    confirm(toolEventId, name, argsJson),
    new Promise<ConfirmDecision>(resolve => {
      timer = setTimeout(() => {
        timedOut = true;
        resolve({ kind: 'deny' });
      }, CONFIRM_TIMEOUT_MS);
    })
  ]);
  clearTimeout(timer);
  switch (decision.kind) {
    case 'allow-once':
    case 'allow-session':
      return { allow: true, decision };
    case 'deny':
      return { allow: false, reason: timedOut ? 'timeout' : 'denied', decision };
  }
}
