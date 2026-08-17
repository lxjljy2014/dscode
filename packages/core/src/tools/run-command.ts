import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { truncate } from './format';
import { defineTool } from './schema';
import type { ToolResult } from './types';

const execFileP = promisify(execFile);

/** 命令最长执行时间 */
const COMMAND_TIMEOUT_MS = 60_000;

export const runCommandTool = defineTool({
  name: 'run_command',
  permission: 'execute',
  description: '在工作目录内执行 shell 命令（最长 60 秒，返回输出与退出码）',
  presentation: {
    presentCall: (args) => ({
      card: 'terminal',
      title: typeof args.command === 'string' ? args.command.slice(0, 80) : 'run_command',
      cwd: undefined,
    }),
  },
  parameters: {
    command: { type: 'string', description: '要执行的命令', required: true },
  },
  async execute(args, ctx): Promise<ToolResult> {
    const { command } = args;
    const shell = process.platform === 'win32' ? 'cmd.exe' : process.env.SHELL ?? '/bin/sh';
    const shellArg = process.platform === 'win32' ? '/c' : '-c';
    try {
      const { stdout, stderr } = await execFileP(shell, [shellArg, command], {
        cwd: ctx.cwd,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        // 传播运行中止信号：agent 停止时杀掉子进程（此前只靠 timeout，停止后子进程仍跑满 60s）
        ...(ctx.signal ? { signal: ctx.signal } : {})
      });
      const output = [stdout, stderr].filter(Boolean).join('\n');
      return {
        ok: true,
        content: truncate(output) || '（无输出）',
        // meta：退出码与 cwd 供 UI 终端卡展示；blocks 标记终端呈现意图
        meta: { exitCode: 0, command, cwd: ctx.cwd },
        blocks: [{ type: 'text', text: truncate(output) || '（无输出）' }]
      };
    } catch (e) {
      // 运行中止（AbortError）：与超时/失败区分，避免误报为命令失败
      if (ctx.signal?.aborted) {
        return { ok: false, error: '命令执行已中止', meta: { exitCode: null, killed: false, command, cwd: ctx.cwd } };
      }
      // 超时（killed）或非零退出码：execFile 的 error 里带有 stdout/stderr/exit code，一并回给模型
      const err = e as { stdout?: string; stderr?: string; code?: number | string; killed?: boolean; message?: string };
      const output = [err.stdout, err.stderr].filter(Boolean).join('\n');
      const prefix = err.killed ? '命令超时（60s）已终止' : `命令失败（退出码 ${String(err.code)})`;
      return {
        ok: false,
        error: `${prefix}: ${truncate(output) || err.message || ''}`,
        meta: { exitCode: typeof err.code === 'number' ? err.code : null, killed: err.killed === true, command, cwd: ctx.cwd }
      };
    }
  },
});
