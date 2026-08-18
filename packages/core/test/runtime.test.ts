import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentRuntime, approvalSignature, closeCacheDbs, createSqliteLlmCache, type AgentEventSink } from '../src';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PermissionMode } from '@dscode/shared';

/** AgentRuntime.start 启动前置校验（不触网）：错误码契约与 no-api-key 事件 */
const noopSink: AgentEventSink = {
  delta: () => {},
  tool: () => {},
  confirm: () => {},
  usage: () => {},
  done: () => {},
  error: () => {},
  sessionStats: () => {},
  context: () => {},
  diff: () => {}
};

const baseInput = {
  sessionId: 's1',
  model: 'm1',
  rawMessages: [],
  sink: noopSink,
  config: { workingDirectory: '/tmp', permissionMode: 'confirm' as const, providers: [] }
};

describe('AgentRuntime.start 启动校验', () => {
  it('无供应商：推送 no-api-key 事件并返回 ok（不触网）', async () => {
    const rt = new AgentRuntime();
    const codes: string[] = [];
    const sink: AgentEventSink = { ...noopSink, error: (_s, code) => codes.push(code) };
    const r = await rt.start({ ...baseInput, sink });
    expect(r).toEqual({ ok: true });
    expect(codes).toEqual(['no-api-key']);
  });

  it('供应商模型列表为空：返回 no-models（不触网）', async () => {
    const rt = new AgentRuntime();
    const r = await rt.start({
      ...baseInput,
      config: {
        workingDirectory: '/tmp',
        permissionMode: 'confirm',
        providers: [{ id: 'p', name: 'P', baseUrl: 'https://api.example.com', apiKey: 'k', models: [] }]
      }
    });
    expect(r).toEqual({ ok: false, error: 'no-models' });
  });
});

describe('approvalSignature', () => {
  it('执行命令按 command 生成签名', () => {
    expect(approvalSignature('run_command', '{"command":"git status"}')).toBe('run_command:git status');
  });

  it('写/编辑文件按 path 生成签名', () => {
    expect(approvalSignature('write_file', '{"path":"src/a.ts"}')).toBe('write_file:src/a.ts');
    expect(approvalSignature('edit_file', '{"path":" src/b.ts "}')).toBe('edit_file:src/b.ts');
  });

  it('浏览按 url、搜索按 query', () => {
    expect(approvalSignature('browse', '{"url":"https://example.com"}')).toBe('browse:https://example.com');
    expect(approvalSignature('search', '{"query":"TODO"}')).toBe('search:TODO');
  });

  it('参数缺失或非法 JSON 时签名退化为仅工具名', () => {
    expect(approvalSignature('run_command', '{}')).toBe('run_command:');
    expect(approvalSignature('run_command', 'not-json')).toBe('run_command:');
  });
});

// ---- 权限模式动态源（运行中切换生效） ----

/** 构造 SSE 流：模拟一次 chat/completions 响应，携带指定工具调用后 [DONE] */
function sseChunk(toolCalls: Array<{ id: string; name: string; arguments: string }>): Uint8Array {
  // 一个完整 data 帧（工具调用全部放在单帧 delta 里，与真实流式累积语义等价）
  const delta = {
    choices: [{
      delta: {
        tool_calls: toolCalls.map((tc, index) => ({
          index,
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments }
        }))
      }
    }]
  };
  const frame = `data: ${JSON.stringify(delta)}\n\ndata: [DONE]\n\n`;
  return new TextEncoder().encode(frame);
}

function mockSseResponse(chunks: Uint8Array[]): Response {
  let i = 0;
  const reader = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]!);
      else controller.close();
    }
  });
  return { ok: true, body: reader } as unknown as Response;
}

describe('permissionModeSource（运行中切换权限模式立即生效）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('提供 source 时，第二轮工具调用按 source 最新值门控（plan 拒写）', async () => {
    // 模型两轮：第一轮 read_file（只读，任何模式放行），第二轮 write_file（写）
    const rounds = [
      sseChunk([{ id: 'c1', name: 'read_file', arguments: '{"path":"a.ts"}' }]),
      sseChunk([{ id: 'c2', name: 'write_file', arguments: '{"path":"b.ts","content":"x"}' }])
    ];
    let call = 0;
    const fetchMock = vi.fn(async () => mockSseResponse([rounds[call++]!]));
    vi.stubGlobal('fetch', fetchMock);

    // 运行中切换：第一轮仍是 confirm，之后切到 plan —— source 每次返回「当前」值
    let currentMode: PermissionMode = 'confirm';
    const source = () => Promise.resolve(currentMode);

    const toolStatuses: Array<{ name: string; status: string }> = [];
    const sink: AgentEventSink = {
      ...noopSink,
      tool: (_s, e) => toolStatuses.push({ name: e.name, status: e.status }),
      error: () => {},
      done: () => {}
    };

    const rt = new AgentRuntime();
    const r = await rt.start({
      ...baseInput,
      sink,
      config: {
        workingDirectory: '/tmp',
        permissionMode: 'confirm',
        permissionModeSource: source,
        providers: [{ id: 'p', name: 'P', baseUrl: 'https://api.example.com', apiKey: 'k', models: ['m1'] }]
      }
    });
    expect(r).toEqual({ ok: true });

    // 等第二轮触发前切换模式：source 是活的，第二轮（write_file）会读到 plan → 被拒
    // 时序：start 异步跑；第一轮 read_file 放行 → 第二轮前我们切换。
    // 为确定性：直接断言 source 被调用且最终 write_file 被拒（plan 模式）。
    // 由于 start 不阻塞到结束，先切模式再等 run 完成：用 done 事件等待。
    currentMode = 'plan';
    await new Promise(resolve => setTimeout(resolve, 50));
    // 等待 fetch 完成两轮
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }, { timeout: 2000 });

    // read_file 放行执行；write_file 在 plan 下被拒（status: denied）
    const denied = toolStatuses.filter(e => e.status === 'denied');
    expect(denied.some(e => e.name === 'write_file')).toBe(true);
    // 确认 fetch 第二次调用发生在切换后（source 读到 plan）
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('缺省（无 source）时整轮固定用启动快照：confirm 模式写工具进入 confirming 等待', async () => {
    const rounds = [
      sseChunk([{ id: 'c1', name: 'write_file', arguments: '{"path":"b.ts","content":"x"}' }])
    ];
    let call = 0;
    const fetchMock = vi.fn(async () => mockSseResponse([rounds[call++]!]));
    vi.stubGlobal('fetch', fetchMock);

    const statuses: Array<{ name: string; status: string }> = [];
    const sink: AgentEventSink = {
      ...noopSink,
      tool: (_s, e) => statuses.push({ name: e.name, status: e.status }),
      error: () => {},
      done: () => {}
    };

    const rt = new AgentRuntime();
    await rt.start({
      ...baseInput,
      sink,
      config: {
        workingDirectory: '/tmp',
        permissionMode: 'confirm',
        providers: [{ id: 'p', name: 'P', baseUrl: 'https://api.example.com', apiKey: 'k', models: ['m1'] }]
      }
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
    // confirm 模式写工具：门控按快照模式挂起确认（等待渲染端确认回调，不会直接执行/拒绝）。
    // 等待 confirming 事件出现（工具调度在 fetch 之后异步推进）
    await vi.waitFor(
      () => expect(statuses.some(e => e.status === 'confirming' && e.name === 'write_file')).toBe(true),
      { timeout: 2000 }
    );
  });
});

// ---- LLM 回复缓存：相同请求重放（省成本） ----


describe('LLM 回复缓存重放（相同请求第二次运行不调 API）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    closeCacheDbs();
  });

  it('第二次相同运行完全重放：fetch 不再调用、stats.hits 增加', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dscode-cache-e2e-'));
    const file = join(dir, 'cache.db');
    try {
      const cache = createSqliteLlmCache(file);
      // 单轮纯文本回复（无工具调用）：round 结束即完成
      const fetchMock = vi.fn(async () => mockSseResponse([sseChunk([])]));
      vi.stubGlobal('fetch', fetchMock);

      const input = {
        sessionId: 's-cache',
        model: 'm1',
        rawMessages: [],
        sink: noopSink,
        config: {
          workingDirectory: '/tmp',
          permissionMode: 'full-access',
          providers: [{ id: 'p', name: 'P', baseUrl: 'https://api.example.com', apiKey: 'k', models: ['m1'] }],
          llmCache: cache
        }
      };
      const rt = new AgentRuntime();

      // 第一次运行：未命中，调 API，落库
      await rt.start(input);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
      await new Promise(resolve => setTimeout(resolve, 100));
      let s = await cache.stats();
      expect(s.hits).toBe(0);
      expect(s.misses).toBe(1);
      expect(s.entries).toBe(1);

      // 第二次完全相同运行：全部重放，不再调 API
      await rt.start(input);
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      s = await cache.stats();
      expect(s.hits).toBe(1);
      expect(s.misses).toBe(1);
      expect(s.entries).toBe(1);
    } finally {
      closeCacheDbs();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---- 上下文占用投影：实时推送（不等待 usage） ----

describe('上下文占用投影（anchored projection）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('运行中推送 context（初始 + 流式增量，无 usage 时为纯启发式）', async () => {
    const textChunk = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hello world"}}]}\n\ndata: [DONE]\n\n');
    const fetchMock = vi.fn(async () => mockSseResponse([textChunk]));
    vi.stubGlobal('fetch', fetchMock);

    const projections: number[] = [];
    const sink: AgentEventSink = {
      ...noopSink,
      context: (_s, p) => projections.push(p.contextTokens),
      done: () => {}
    };
    const rt = new AgentRuntime();
    await rt.start({
      ...baseInput,
      sink,
      config: {
        workingDirectory: '/tmp',
        permissionMode: 'full-access',
        providers: [{ id: 'p', name: 'P', baseUrl: 'https://api.example.com', apiKey: 'k', models: ['m1'] }]
      }
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
    await new Promise(resolve => setTimeout(resolve, 100));
    // 至少初始一次 + 流式增量一次；系统提示词/工具 schema 非空，启发式占用 > 0
    expect(projections.length).toBeGreaterThanOrEqual(2);
    expect(projections[0]).toBeGreaterThan(0);
  });
});