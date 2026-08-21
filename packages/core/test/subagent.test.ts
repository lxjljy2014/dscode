import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentRuntime, TOOL_NAMES, toolSchemas, type AgentEventSink } from '../src';
import { taskTool } from '../src/tools/task';

/**
 * 子任务派发（task 工具）：薄壳透传、端到端闭环（独立上下文只回结论）、
 * 子任务工具白名单拦截、子智能体配置解析与轮数上限。
 */

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

const provider = { id: 'p', name: 'P', baseUrl: 'https://api.example.com', apiKey: 'k', models: ['m1'] };

/** 单帧工具调用 SSE 响应 */
function sseChunk(toolCalls: Array<{ id: string; name: string; arguments: string }>): Uint8Array {
  const delta = {
    choices: [
      {
        delta: {
          tool_calls: toolCalls.map((tc, index) => ({ index, id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } }))
        }
      }
    ]
  };
  return new TextEncoder().encode(`data: ${JSON.stringify(delta)}\n\ndata: [DONE]\n\n`);
}

/** 单帧纯文本 SSE 响应 */
function sseText(text: string): Uint8Array {
  const delta = { choices: [{ delta: { content: text } }] };
  return new TextEncoder().encode(`data: ${JSON.stringify(delta)}\n\ndata: [DONE]\n\n`);
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

describe('task 工具（薄壳）', () => {
  it('已注册且对模型暴露', () => {
    expect(TOOL_NAMES).toContain('task');
    const names = (toolSchemas(true) as Array<{ function: { name: string } }>).map(t => t.function.name);
    expect(names).toContain('task');
  });

  it('运行环境未注入派发实现时报错', async () => {
    const r = await taskTool.execute({ description: '调研', prompt: '找入口' }, { cwd: '/tmp' });
    expect(r.ok).toBe(false);
  });

  it('透传请求参数并映射子任务结果', async () => {
    const seen: unknown[] = [];
    const signal = new AbortController().signal;
    const ok = await taskTool.execute({ description: '调研', prompt: '找入口', subagent: '探索者' }, {
      cwd: '/tmp',
      signal,
      spawnSubagent: async (req, sig) => {
        seen.push({ req, isSameSignal: sig === signal });
        return { ok: true, content: '入口在 src/main.ts' };
      }
    });
    expect(ok).toEqual({ ok: true, content: '入口在 src/main.ts' });
    const bad = await taskTool.execute({ description: 'd', prompt: 'p' }, {
      cwd: '/tmp',
      spawnSubagent: async () => ({ ok: false, content: '子任务失败：api' })
    });
    expect(bad).toEqual({ ok: false, error: '子任务失败：api' });
    expect(seen[0]).toMatchObject({ req: { prompt: '找入口', subagent: '探索者' }, isSameSignal: true });
  });
});

describe('子任务派发（runtime 集成）', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'dscode-subagent-'));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(cwd, { recursive: true, force: true });
  });

  it('端到端：主运行派发子任务，子任务结论作为 task 结果返回主上下文', async () => {
    // fetch 序列：1) 主轮：调 task 工具 2) 子任务（独立上下文）：纯文本结论 3) 主轮：最终回答
    const responses = [
      sseChunk([{ id: 'c1', name: 'task', arguments: '{"description":"找入口","prompt":"找到应用入口文件"}' }]),
      sseText('入口是 src/main.ts'),
      sseText('已根据子任务结论完成回复')
    ];
    let call = 0;
    const fetchMock = vi.fn(async () => mockSseResponse([responses[call++]!]));
    vi.stubGlobal('fetch', fetchMock);

    const deltas: string[] = [];
    const toolEvents: Array<{ name: string; status: string; content?: string }> = [];
    const sink: AgentEventSink = {
      ...noopSink,
      delta: (_s, kind, c) => { if (kind === 'content') deltas.push(c); },
      tool: (_s, e) => toolEvents.push({ name: e.name, status: e.status, content: e.content })
    };
    const rt = new AgentRuntime();
    await rt.start({ ...baseInput, sink, config: { workingDirectory: cwd, permissionMode: 'confirm', providers: [provider] } });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3), { timeout: 3000 });
    // 最终回答推给主会话（子任务正文不进主 delta 流）
    await vi.waitFor(() => expect(deltas.join('')).toBe('已根据子任务结论完成回复'), { timeout: 3000 });
    // task 工具完成事件携带子任务结论
    const taskDone = toolEvents.find(e => e.name === 'task' && e.status === 'done');
    expect(taskDone?.content).toBe('入口是 src/main.ts');
    // 子任务工具过程不上抛主会话（本例子里子任务未调工具）
    expect(toolEvents.filter(e => e.name !== 'task')).toEqual([]);
  });

  it('子任务内调用白名单外工具：返回结构化错误且不执行', async () => {
    // fetch 序列：1) 主轮：task 2) 子轮：尝试 write_file（应被拦）3) 子轮：改正为纯文本 4) 主轮：最终回答
    const responses = [
      sseChunk([{ id: 'c1', name: 'task', arguments: '{"description":"调查","prompt":"看看目录"}' }]),
      sseChunk([{ id: 'sub-c1', name: 'write_file', arguments: '{"path":"evil.txt","content":"x"}' }]),
      sseText('好的，我只做了只读调查'),
      sseText('完成')
    ];
    let call = 0;
    const fetchMock = vi.fn(async () => mockSseResponse([responses[call++]!]));
    vi.stubGlobal('fetch', fetchMock);

    const deltas: string[] = [];
    const sink: AgentEventSink = { ...noopSink, delta: (_s, k, c) => { if (k === 'content') deltas.push(c); } };
    const rt = new AgentRuntime();
    await rt.start({ ...baseInput, sink, config: { workingDirectory: cwd, permissionMode: 'confirm', providers: [provider] } });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4), { timeout: 3000 });
    await vi.waitFor(() => expect(deltas.join('')).toBe('完成'), { timeout: 3000 });
    // 白名单生效：子任务里的 write_file 从未执行（文件不存在）
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(cwd, 'evil.txt'))).toBe(false);
  });

  it('子智能体配置：按名解析人设、maxTurns 收敛为失败结果', async () => {
    // 子智能体 maxTurns=1：子任务第 1 轮调工具后即达上限 → 子任务 max-rounds 失败 → task 结果失败
    const responses = [
      sseChunk([{ id: 'c1', name: 'task', arguments: '{"description":"调查","prompt":"找东西","subagent":"探索者"}' }]),
      sseChunk([{ id: 'sub-c1', name: 'read_file', arguments: '{"path":"a.txt"}' }]),
      sseText('主任务收到失败说明后继续')
    ];
    let call = 0;
    const fetchMock = vi.fn(async () => mockSseResponse([responses[call++]!]));
    vi.stubGlobal('fetch', fetchMock);

    const toolEvents: Array<{ name: string; status: string; error?: string; content?: string }> = [];
    const sink: AgentEventSink = { ...noopSink, tool: (_s, e) => toolEvents.push({ name: e.name, status: e.status, error: e.error, content: e.content }) };
    const rt = new AgentRuntime();
    await rt.start({
      ...baseInput,
      sink,
      config: {
        workingDirectory: cwd,
        permissionMode: 'confirm',
        providers: [provider],
        subagents: [{ id: 'ex', name: '探索者', description: '', systemPrompt: '你是探索者', maxTurns: 1 }]
      }
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3), { timeout: 3000 });
    // task 工具以错误收尾，内容含子任务失败原因（max-rounds）
    // 注意取终态事件（同一 toolEventId 会先推 running 再推 error）
    const terminal = () => [...toolEvents].reverse().find(e => e.name === 'task' && e.status !== 'running');
    await vi.waitFor(
      () => expect(terminal()?.status === 'error' || (terminal()?.content ?? '').includes('子任务失败')).toBe(true),
      { timeout: 3000 }
    );
  });

  it('子任务次数上限：超过 5 次后拒绝派发', async () => {
    // 主模型连续 6 轮派发 task：第 6 次被拒（返回错误结果），主模型随后正常收尾
    const responses: Uint8Array[] = [];
    for (let i = 1; i <= 6; i++) {
      responses.push(sseChunk([{ id: `c${i}`, name: 'task', arguments: `{"description":"t${i}","prompt":"p${i}"}` }]));
      responses.push(sseText('结论')); // 子任务响应
    }
    responses.push(sseText('结束'));
    let call = 0;
    const fetchMock = vi.fn(async () => mockSseResponse([responses[call++]!]));
    vi.stubGlobal('fetch', fetchMock);

    const sink: AgentEventSink = { ...noopSink, delta: () => {} };
    const rt = new AgentRuntime();
    await rt.start({ ...baseInput, sink, config: { workingDirectory: cwd, permissionMode: 'confirm', providers: [provider] } });

    // 6 次主轮 + 5 次子任务响应（第 6 次派发被拒不再请求子 LLM）+ 1 次收尾 = 12
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(12), { timeout: 5000 });
  });

  it('可写子任务（writable + full-access）：子任务写文件并计入父 diff', async () => {
    // fetch 序列：1) 主轮：task（指定可写子智能体）2) 子轮：write_file（真写盘）3) 子轮：结论 4) 主轮：最终回答
    const responses = [
      sseChunk([{ id: 'c1', name: 'task', arguments: '{"description":"生成","prompt":"写一个文件","subagent":"执行者"}' }]),
      sseChunk([{ id: 'sub-c1', name: 'write_file', arguments: '{"path":"gen.ts","content":"export const x = 1;\\n"}' }]),
      sseText('已生成 gen.ts'),
      sseText('完成')
    ];
    let call = 0;
    const fetchMock = vi.fn(async () => mockSseResponse([responses[call++]!]));
    vi.stubGlobal('fetch', fetchMock);

    const diffPushes: string[][] = [];
    const toolEvents: Array<{ name: string; status: string; content?: string }> = [];
    const sink: AgentEventSink = {
      ...noopSink,
      tool: (_s, e) => toolEvents.push({ name: e.name, status: e.status, content: e.content }),
      diff: (_s, files) => diffPushes.push(files.map(f => f.path))
    };
    const rt = new AgentRuntime();
    await rt.start({
      ...baseInput,
      sink,
      config: {
        workingDirectory: cwd,
        permissionMode: 'full-access',
        providers: [provider],
        subagents: [{ id: 'w', name: '执行者', description: '', systemPrompt: '你是执行者', writable: true }]
      }
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4), { timeout: 3000 });
    // 子任务真的写了文件
    const { existsSync, readFileSync } = await import('node:fs');
    await vi.waitFor(() => expect(existsSync(join(cwd, 'gen.ts'))).toBe(true), { timeout: 2000 });
    expect(readFileSync(join(cwd, 'gen.ts'), 'utf8')).toBe('export const x = 1;\n');
    // 可写子任务结束后全量 diff 捡漏：父会话收到含该文件的 diff 推送
    await vi.waitFor(
      () => expect(diffPushes.some(paths => paths.includes('gen.ts'))).toBe(true),
      { timeout: 3000 }
    );
    // task 完成事件携带子结论
    const taskDone = toolEvents.find(e => e.name === 'task' && e.status === 'done');
    expect(taskDone?.content).toBe('已生成 gen.ts');
  });

  it('可写子任务在 confirm 模式下收敛为只读（需审批的工具不暴露）', async () => {
    // 父运行 confirm：writable=true 也不给写工具——子调 write_file 得到结构化错误、不执行
    const responses = [
      sseChunk([{ id: 'c1', name: 'task', arguments: '{"description":"写","prompt":"写文件","subagent":"执行者"}' }]),
      sseChunk([{ id: 'sub-c1', name: 'write_file', arguments: '{"path":"nope.txt","content":"x"}' }]),
      sseText('无法写文件，只完成了调查'),
      sseText('完成')
    ];
    let call = 0;
    const fetchMock = vi.fn(async () => mockSseResponse([responses[call++]!]));
    vi.stubGlobal('fetch', fetchMock);

    const sink: AgentEventSink = { ...noopSink, delta: () => {} };
    const rt = new AgentRuntime();
    await rt.start({
      ...baseInput,
      sink,
      config: {
        workingDirectory: cwd,
        permissionMode: 'confirm',
        providers: [provider],
        subagents: [{ id: 'w', name: '执行者', description: '', systemPrompt: '你是执行者', writable: true }]
      }
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4), { timeout: 3000 });
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(cwd, 'nope.txt'))).toBe(false);
  });

  it('可写子任务在 auto-edit 模式下：文件编辑放行、命令执行仍被拦', async () => {
    // 序列：主 task → 子 write_file（放行，写盘）→ 子 run_command（execute 需确认，不暴露 → 拦）→ 子结论 → 主最终
    const responses = [
      sseChunk([{ id: 'c1', name: 'task', arguments: '{"description":"改","prompt":"改文件","subagent":"执行者"}' }]),
      sseChunk([{ id: 'sub-c1', name: 'write_file', arguments: '{"path":"edited.ts","content":"new\\n"}' }]),
      sseChunk([{ id: 'sub-c2', name: 'run_command', arguments: '{"command":"echo hi"}' }]),
      sseText('已改文件，命令未执行'),
      sseText('完成')
    ];
    let call = 0;
    const fetchMock = vi.fn(async () => mockSseResponse([responses[call++]!]));
    vi.stubGlobal('fetch', fetchMock);

    const sink: AgentEventSink = { ...noopSink, delta: () => {} };
    const rt = new AgentRuntime();
    await rt.start({
      ...baseInput,
      sink,
      config: {
        workingDirectory: cwd,
        permissionMode: 'auto-edit',
        providers: [provider],
        subagents: [{ id: 'w', name: '执行者', description: '', systemPrompt: '你是执行者', writable: true }]
      }
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5), { timeout: 3000 });
    const { existsSync } = await import('node:fs');
    await vi.waitFor(() => expect(existsSync(join(cwd, 'edited.ts'))).toBe(true), { timeout: 2000 });
  });
});
