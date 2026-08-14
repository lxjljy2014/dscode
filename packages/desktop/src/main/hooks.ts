import { exec } from 'node:child_process';
import type { Hook, HookTrigger } from '@dscode/shared';

/**
 * 生命周期钩子执行：在触发时机下运行匹配的 shell 命令（fire-and-forget）。
 * 命令由用户自己在设置中配置，故经 shell 执行；失败仅告警，不阻断主流程。
 */
export function fireHooks(hooks: Hook[], trigger: HookTrigger, cwd: string): void {
  for (const h of hooks) {
    if (h.trigger !== trigger) continue;
    exec(h.command, { cwd }, err => {
      if (err) console.warn('[hook] ' + h.name + ' 执行失败:', err.message);
    });
  }
}
