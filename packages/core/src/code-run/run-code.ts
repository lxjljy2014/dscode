/**
 * run_code 工具（Code Mode 折叠，借鉴官方 harness code-mode 设计）：
 * 只向模型暴露一个 run_code 工具；程序内通过生成的 SDK 绑定调用其它工具（读/搜/写/执行），
 * 一次工具调用代替 N 次模型往返——省 token、降延迟；程序体内可做条件逻辑与批量操作。
 * 程序在独立 worker 线程执行（隔离宿主状态），工具调用经消息桥接回主线程执行。
 * 门控模型：run_code 自身是 execute 权限（confirm 模式需一次确认），程序内子调用视为程序整体行为不再逐个确认。
 */

/* oxlint-disable unicorn/require-post-message-target-origin -- node worker_threads 的 postMessage 无 targetOrigin */

import type { Worker } from 'node:worker_threads';
import { defineTool } from '../tools/schema';
import { createRunCodeWorker } from './worker';
import { TOOLS, executeTool } from '../tools';
import type { ToolContext, ToolResult } from '../tools/types';

/** 程序可调用的工具名（注册表中的全部工具，除 run_code 自身防递归）；延迟求值避免与 tools/index 的循环依赖 */
let codeBindings: string[] | null = null;
function getCodeBindings(): string[] {
  codeBindings ??= Object.keys(TOOLS).filter(n => n !== 'run_code');
  return codeBindings;
}

/** 生成程序可见的 SDK 绑定说明（模型写程序时参考） */
function sdkSection(): string {
  const lines = getCodeBindings().map(name => {
    const t = TOOLS[name as keyof typeof TOOLS];
    const props = Object.entries((t.parameters.properties ?? {}) as Record<string, { description?: string }>)
      .map(([k, v]) => `${k}: ${v?.description ?? ''}`)
      .join('; ');
    return `- await tools.${name}({ ${props} }) —— ${t.description}`;
  });
  return ['可用工具（程序内通过 tools 命名空间调用，均为异步）：', ...lines].join('\n');
}

/** worker 单例（首次调用时启动；主进程生命周期内复用；异常/退出后重建） */
let worker: Worker | null = null;
let workerReady: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (worker) return Promise.resolve(worker);
  if (!workerReady) {
    workerReady = new Promise((resolve, reject) => {
      const w = createRunCodeWorker();
      w.on('error', err => {
        worker = null;
        workerReady = null;
        reject(err);
      });
      w.on('exit', () => {
        worker = null;
        workerReady = null;
      });
      worker = w;
      resolve(w);
    });
  }
  return workerReady;
}

interface ToolCallMsg {
  type: 'tool-call';
  id: number;
  name: string;
  args: unknown;
}

type WorkerMsg =
  | ToolCallMsg
  | { type: 'done'; value: unknown }
  | { type: 'error'; message: string }
  | { type: 'tool-result'; id: number; result: { ok: boolean; content?: string; error?: string } };

async function runProgram(
  code: string,
  description: string,
  ctx: ToolContext,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const w = await getWorker();
  return new Promise(resolve => {
    const onMessage = (raw: unknown): void => {
      const msg = raw as WorkerMsg;
      if (msg.type === 'tool-call') {
        // 桥接工具调用：主线程统一执行（含参数校验/超时/管线）；run_code 已整体过门控，子调用不再逐个确认
        void (async () => {
          const result = await executeTool(msg.name, JSON.stringify(msg.args ?? {}), ctx.cwd, { signal: ctx.signal, skills: ctx.skills });
          w.postMessage({
            type: 'tool-result',
            id: msg.id,
            result: result.ok ? { ok: true, content: result.content } : { ok: false, error: result.error },
          });
        })();
        return;
      }
      if (msg.type === 'done') {
        w.off('message', onMessage);
        resolve({ ok: true, value: msg.value });
        return;
      }
      if (msg.type === 'error') {
        w.off('message', onMessage);
        resolve({ ok: false, error: msg.message });
      }
    };
    w.on('message', onMessage);
    w.postMessage({ type: 'run', code, description, bindings: getCodeBindings() });
  });
}

/** run_code 工具定义：程序体在 worker 执行，返回程序 return 值（JSON 序列化）；concurrency 保持 exclusive */
export const runCodeTool = defineTool({
  name: 'run_code',
  permission: 'execute',
  description:
    '执行一段 TypeScript 程序（async 函数体，`await`/`return` 可用）并返回其值。' +
    '程序内通过 tools 命名空间调用可用工具；工具结果以字符串返回，' +
    '程序负责处理并只 return 精简结果。适合批量/条件操作，一次调用代替多次工具往返。',
  parameters: {
    code: { type: 'string', description: '程序体（async 函数体，可用 await/return；tools 命名空间见运行时注入的 SDK 说明）', required: true },
    description: { type: 'string', description: '程序做什么的一句话说明（供排障）', required: true },
  },
  async execute(args, ctx): Promise<ToolResult> {
    // 自动注入 SDK 绑定说明：模型写程序时参考（首次调用即带全量工具用法）
    const sdk = '/* 可用工具（经 tools 命名空间调用，均异步）：\n' + sdkSection() + ' */\n\n';
    const code = args.code.startsWith('/* 可用工具') ? args.code : sdk + args.code;
    const r = await runProgram(code, args.description, ctx);
    if (!r.ok) return { ok: false, error: r.error };
    try {
      const value = JSON.stringify(r.value, null, 2);
      return { ok: true, content: value.slice(0, 24 * 1024) || '（无返回值）' };
    } catch {
      return { ok: true, content: String(r.value) };
    }
  },
});