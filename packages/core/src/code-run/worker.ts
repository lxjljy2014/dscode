/**
 * run_code worker 执行器（借鉴官方 harness code-runtime-worker-thread 的桥接设计，轻量版）。
 * 程序体在独立 worker 线程运行（隔离宿主状态），工具调用经消息桥接回主线程执行（带门控）。
 * 使用 inline worker（eval 模式）：worker 代码内联在字符串中，无需独立构建文件，
 * 适配 electron-vite 把 core 打进 main 产物的场景。
 */

import { Worker } from 'node:worker_threads';

/** worker 线程内的执行逻辑（内联字符串；主线程通过消息与之通信） */
const WORKER_SOURCE = `
const { parentPort } = require('node:worker_threads');

const port = parentPort;
if (!port) throw new Error('run_code worker 必须经 Worker 启动');

function waitToolResult(id) {
  return new Promise((resolve, reject) => {
    const onMessage = (msg) => {
      if (msg && msg.type === 'tool-result' && msg.id === id) {
        port.off('message', onMessage);
        resolve(msg.result);
      }
    };
    port.on('message', onMessage);
    // 超时保护：单次工具调用最长 60s（与 run_command 一致）
    setTimeout(() => {
      port.off('message', onMessage);
      reject(new Error('工具调用超时（60s）'));
    }, 60000);
  });
}

port.on('message', async (req) => {
  if (!req || req.type !== 'run') return;
  let seq = 0;
  try {
    // 构造程序可见的 tools 命名空间：每个绑定经桥接回主线程
    const tools = Object.create(null);
    for (const name of req.bindings || []) {
      Object.defineProperty(tools, name, {
        enumerable: true,
        configurable: false,
        writable: false,
        value: (args) => {
          const id = seq++;
          // oxlint-disable-next-line unicorn/require-post-message-target-origin -- node worker_threads 的 postMessage 无 targetOrigin
          port.postMessage({ type: 'tool-call', id, name, args: args === undefined ? {} : args });
          return waitToolResult(id).then(r => (r.ok ? (r.content || '') : 'Error: ' + (r.error || '未知错误')));
        },
      });
    }
    // 程序体：async 函数体（模型写，await/return 可用）
    const body = 'return (async () => {\\n' + (req.code || '') + '\\n})();';
    const fn = new Function('tools', 'description', body);
    const value = await fn(tools, req.description || '');
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- node worker_threads 的 postMessage 无 targetOrigin
          port.postMessage({ type: 'done', value: value === undefined ? null : value });
  } catch (e) {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- node worker_threads 的 postMessage 无 targetOrigin
          port.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
});
`;

/**
 * 启动 run_code worker（inline eval 模式）。
 * 注意：electron-vite 会把本模块打进 main 产物，Worker 由 require('node:worker_threads') 内联启动，无独立文件。
 */
export function createRunCodeWorker(): Worker {
  return new Worker(WORKER_SOURCE, { eval: true });
}