import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/** MCP 工具摘要（tools/list 的结果） */
export interface McpToolInfo {
  name: string;
  description: string;
}

/** MCP 服务器描述（command + args，stdio 传输） */
export interface McpServerLike {
  command: string;
  args: string[];
}

interface RpcMessage {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message?: string };
}

/**
 * 最小 MCP stdio 客户端：spawn 服务器进程，走 JSON-RPC（换行分隔）完成
 * initialize → notifications/initialized → tools/list，返回工具摘要后关闭进程。
 * 仅用于「列出工具」；把 MCP 工具纳入 agent 工具循环是后续工作。
 */
export async function listMcpTools(server: McpServerLike, timeoutMs = 10000): Promise<McpToolInfo[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(server.command, server.args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const rl = createInterface({ input: child.stdout });
    let nextId = 1;
    const pending = new Map<number, (msg: RpcMessage) => void>();

    function finish(fn: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      fn();
    }

    const timer = setTimeout(() => finish(() => reject(new Error('MCP 服务器响应超时'))), timeoutMs);

    rl.on('line', line => {
      let msg: RpcMessage;
      try {
        msg = JSON.parse(line) as RpcMessage;
      } catch {
        return;
      }
      if (typeof msg.id === 'number' && pending.has(msg.id)) {
        const cb = pending.get(msg.id);
        pending.delete(msg.id);
        cb?.(msg);
      }
    });

    child.on('error', err => finish(() => reject(err)));
    child.on('exit', () => {
      if (!settled) finish(() => reject(new Error('MCP 服务器提前退出')));
    });

    function send(id: number | null, method: string, params: unknown): void {
      const payload: Record<string, unknown> = { jsonrpc: '2.0', method, params };
      if (id !== null) payload['id'] = id;
      child.stdin.write(JSON.stringify(payload) + '\n');
    }

    function request(method: string, params: unknown): Promise<Record<string, unknown>> {
      return new Promise((res, rej) => {
        const id = nextId++;
        pending.set(id, msg => {
          if (msg.error) rej(new Error(msg.error.message ?? 'MCP 错误'));
          else res(msg.result ?? {});
        });
        send(id, method, params);
      });
    }

    (async () => {
      await request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'dscode', version: '0.0.0' }
      });
      send(null, 'notifications/initialized', {});
      const list = await request('tools/list', {});
      const tools = (Array.isArray(list['tools']) ? list['tools'] : []).map(t => {
        const tool = t as { name?: string; description?: string };
        return { name: tool.name ?? '', description: tool.description ?? '' };
      });
      finish(() => resolve(tools));
    })().catch(err => finish(() => reject(err instanceof Error ? err : new Error(String(err)))));
  });
}
