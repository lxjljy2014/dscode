import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { truncate } from './format';
import { STRING, strArg } from './types';
import type { Tool, ToolContext, ToolResult } from './types';

const execFileP = promisify(execFile);

/** 命令最长执行时间 */
const COMMAND_TIMEOUT_MS = 60_000;

export const runCommandTool: Tool = {
  name: 'run_command',
  permission: 'execute',
  description: '在工作目录内执行 shell 命令（最长 60 秒，返回输出与退出码）',
  parameters: {
    type: 'object',
    properties: { command: { ...STRING, description: '要执行的命令' } },
    required: ['command']
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const command = strArg(args, 'command');
    if (!command) return { ok: false, error: '缺少参数 command' };
    const shell = process.platform === 'win32' ? 'cmd.exe' : process.env.SHELL ?? '/bin/sh';
    const shellArg = process.platform === 'win32' ? '/c' : '-c';
    try {
      const { stdout, stderr } = await execFileP(shell, [shellArg, command], {
        cwd: ctx.cwd,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true
      });
      const output = [stdout, stderr].filter(Boolean).join('\n');
      return { ok: true, content: truncate(output) || '（无输出）' };
    } catch (e) {
      // 超时（killed）或非零退出码：execFile 的 error 里带有 stdout/stderr/exit code，一并回给模型
      const err = e as { stdout?: string; stderr?: string; code?: number | string; killed?: boolean; message?: string };
      const output = [err.stdout, err.stderr].filter(Boolean).join('\n');
      const prefix = err.killed ? '命令超时（60s）已终止' : `命令失败（退出码 ${String(err.code)})`;
      return { ok: false, error: `${prefix}: ${truncate(output) || err.message || ''}` };
    }
  }
};
