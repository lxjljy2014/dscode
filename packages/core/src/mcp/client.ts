import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

/** MCP 工具摘要（tools/list 的结果） */
export interface McpToolInfo {
  name: string;
  description: string;
  /** 工具参数 schema（JSON Schema，服务器提供时透传给 agent 工具表） */
  inputSchema?: unknown;
}

/** MCP 服务器描述（command + args，stdio 传输）；id 用于连接池键与 agent 工具命名 */
export interface McpServerLike {
  id?: string;
  command: string;
  args: string[];
}

interface RpcMessage {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message?: string };
}

/** 连接空闲回收时长：长驻连接仅在有活跃 agent 使用时保留 */
const IDLE_TIMEOUT_MS = 30 * 60_000;

/** 连接级失败（进程退出/启动失败）：池据此在下次获取时重建连接 */
export class McpConnectionClosedError extends Error {
  constructor(message = 'MCP 连接已关闭') {
    super(message);
    this.name = 'McpConnectionClosedError';
  }
}

/**
 * MCP stdio 长连接：spawn 服务器进程走 JSON-RPC（换行分隔），initialize 一次后复用
 * 连接完成 tools/list 与 tools/call。空闲超过 IDLE_TIMEOUT_MS 自动回收；
 * 进程意外退出时全部挂起请求按失败结算，连接标记失效。
 */
export class McpConnection {
  private child: ChildProcess;
  private nextId = 1;
  private pending = new Map<number, (msg: RpcMessage) => void>();
  private initPromise: Promise<void> | null = null;
  private idleTimer: NodeJS.Timeout;
  private exited = false;

  constructor(server: McpServerLike) {
    this.child = spawn(server.command, server.args, { stdio: ['pipe', 'pipe', 'pipe'] });
    // 排空 stderr：不消费时 stderr 管道缓冲区填满会阻塞服务器进程
    this.child.stderr?.resume();
    // stdio 全 pipe 声明下运行时必有 stdout
    const stdout = this.child.stdout;
    if (!stdout) {
      this.exited = true;
      this.idleTimer = setTimeout(() => this.close(), IDLE_TIMEOUT_MS);
      return;
    }
    const rl = createInterface({ input: stdout });
    rl.on('line', line => {
      let msg: RpcMessage;
      try {
        msg = JSON.parse(line) as RpcMessage;
      } catch {
        return;
      }
      if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
        const cb = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        cb?.(msg);
      }
    });
    this.child.on('error', () => this.failAll(new McpConnectionClosedError('MCP 服务器启动失败')));
    this.child.on('exit', () => this.failAll(new McpConnectionClosedError('MCP 服务器提前退出')));
    this.idleTimer = setTimeout(() => this.close(), IDLE_TIMEOUT_MS);
  }

  get isClosed(): boolean {
    return this.exited;
  }

  /** 重置空闲计时（每次请求前后调用） */
  private bumpIdle(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.close(), IDLE_TIMEOUT_MS);
  }

  /** 进程级失败：结算全部挂起请求并标记失效 */
  private failAll(err: Error): void {
    if (this.exited) return;
    this.exited = true;
    clearTimeout(this.idleTimer);
    for (const cb of this.pending.values()) cb({ error: { message: err.message } });
    this.pending.clear();
    this.initPromise = null;
  }

  private send(id: number | null, method: string, params: unknown): void {
    const stdin = this.child.stdin;
    if (this.exited || !stdin || stdin.destroyed) throw new McpConnectionClosedError();
    const payload: Record<string, unknown> = { jsonrpc: '2.0', method, params };
    if (id !== null) payload['id'] = id;
    stdin.write(JSON.stringify(payload) + '\n');
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<Record<string, unknown>> {
    if (this.exited) return Promise.reject(new McpConnectionClosedError());
    return new Promise((res, rej) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rej(new Error('MCP 服务器响应超时'));
      }, timeoutMs);
      this.pending.set(id, msg => {
        clearTimeout(timer);
        if (msg.error) rej(new Error(msg.error.message ?? 'MCP 错误'));
        else res(msg.result ?? {});
      });
      try {
        this.send(id, method, params);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        rej(e);
      }
    });
  }

  /** 惰性 initialize（首个请求前完成一次握手；失败可重试） */
  private ensureInit(timeoutMs: number): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        await this.request(
          'initialize',
          {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'dscode', version: '0.0.0' }
          },
          timeoutMs
        );
        this.send(null, 'notifications/initialized', {});
      })().catch(e => {
        this.initPromise = null;
        throw e;
      });
    }
    return this.initPromise;
  }

  /** 列出服务器工具（initialize 惰性完成；超时/进程退出按错误结算） */
  async listTools(timeoutMs = 10_000): Promise<McpToolInfo[]> {
    this.bumpIdle();
    await this.ensureInit(timeoutMs);
    const list = await this.request('tools/list', {}, timeoutMs);
    this.bumpIdle();
    const tools = Array.isArray(list['tools']) ? list['tools'] : [];
    return tools.map(t => {
      const tool = t as { name?: string; description?: string; inputSchema?: unknown };
      return {
        name: tool.name ?? '',
        description: tool.description ?? '',
        ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {})
      };
    });
  }

  /** 调用服务器工具，返回 tools/call 的原始 result（content 解析由调用方完成） */
  async callTool(name: string, args: Record<string, unknown>, timeoutMs = 60_000): Promise<Record<string, unknown>> {
    this.bumpIdle();
    await this.ensureInit(timeoutMs);
    const result = await this.request('tools/call', { name, arguments: args }, timeoutMs);
    this.bumpIdle();
    return result;
  }

  /** 主动关闭（空闲回收 / 应用退出） */
  close(): void {
    if (this.exited) return;
    this.failAll(new McpConnectionClosedError());
    this.child.kill();
  }
}

// ---- 连接池（模块级；键 = server id 或 command+args） ----

const pool = new Map<string, McpConnection>();

function serverKey(server: McpServerLike): string {
  return server.id ?? `${server.command}\u0000${server.args.join('\u0000')}`;
}

/** 获取（或建立）服务器的池化连接；已失效的连接会被新连接替换 */
export function getMcpConnection(server: McpServerLike): McpConnection {
  const key = serverKey(server);
  const existing = pool.get(key);
  if (existing && !existing.isClosed) return existing;
  const conn = new McpConnection(server);
  pool.set(key, conn);
  return conn;
}

/** 列出服务器工具（走连接池长驻复用；对外签名与旧一次性实现兼容） */
export async function listMcpTools(server: McpServerLike, timeoutMs = 10000): Promise<McpToolInfo[]> {
  return getMcpConnection(server).listTools(timeoutMs);
}

/** 调用 MCP 服务器工具（走连接池） */
export async function callMcpTool(
  server: McpServerLike,
  name: string,
  args: Record<string, unknown>,
  timeoutMs = 60_000
): Promise<Record<string, unknown>> {
  return getMcpConnection(server).callTool(name, args, timeoutMs);
}

/** 回收全部池化连接（应用退出前调用） */
export function disposeMcpConnections(): void {
  for (const conn of pool.values()) conn.close();
  pool.clear();
}
