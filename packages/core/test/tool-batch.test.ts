import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executeToolBatch } from '../src/agent/tool-batch';
import type { AgentToolEvent } from '@dscode/shared';
import type { AgentEventSink } from '../src/agent/types';
import type { ToolBatchRuntime } from '../src/agent/tool-batch';

let cwd: string;

beforeAll(async () => {
  // 真实临时工作目录：read_file/list_dir/write_file 需要真实文件系统，自包含不污染仓库
  cwd = await mkdtemp(join(tmpdir(), 'dscode-toolbatch-'));
  await writeFile(join(cwd, 'package.json'), '{"name":"fixture"}', 'utf8');
});

afterAll(async () => {
  await import('node:fs/promises').then(m => m.rm(cwd, { recursive: true, force: true }));
});

function noopSink(): AgentEventSink {
  return {
    delta: () => {}, tool: () => {}, confirm: () => {}, usage: () => {},
    done: () => {}, error: () => {}, diff: () => {}, sessionStats: () => {}, context: () => {}
  };
}

function makeRuntime(overrides: Partial<ToolBatchRuntime> = {}): ToolBatchRuntime {
  let seq = 0;
  return {
    nextToolId: () => 't-' + (seq++),
    addToolMs: () => {},
    sessionApprovals: new Map(),
    pendingConfirms: new Map(),
    abortRun: () => {},
    recomputeDiff: async () => {},
    skills: [],
    ...overrides
  };
}

describe('executeToolBatch（并行调度：模型顺序提交 + 独占 barrier）', () => {
  it('多个 parallel 工具并行执行且结果按模型顺序提交', async () => {
    const order: string[] = [];
    const done: AgentToolEvent[] = [];
    const sink = {
      ...noopSink(),
      tool: (_sid: string, e: AgentToolEvent) => {
        order.push(e.status);
        if (e.status === 'done') done.push(e);
      }
    };
    const calls = [
      { id: 'call-1', name: 'read_file' as const, arguments: JSON.stringify({ path: 'package.json' }) },
      { id: 'call-2', name: 'list_dir' as const, arguments: '{}' }
    ];
    const messages: unknown[] = [];
    const ok = await executeToolBatch('s1', 'full-access', calls, messages, cwd, new AbortController().signal, sink, makeRuntime());
    expect(ok.continueLoop).toBe(true);
    expect(ok.concluded).toBe(false);
    expect(messages.length).toBe(2);
    // 模型顺序提交：call-1 的结果先于 call-2
    expect((messages[0] as { tool_call_id: string }).tool_call_id).toBe('call-1');
    expect((messages[1] as { tool_call_id: string }).tool_call_id).toBe('call-2');
    expect(done.length).toBe(2);
  });

  it('exclusive 工具打断并行段：形成 barrier 且顺序保持', async () => {
    const done: AgentToolEvent[] = [];
    const sink = {
      ...noopSink(),
      tool: (_sid: string, e: AgentToolEvent) => { if (e.status === 'done') done.push(e); }
    };
    // read(parallel) → write(exclusive) → read(parallel)：三段调度，顺序保持
    const calls = [
      { id: 'c1', name: 'read_file' as const, arguments: JSON.stringify({ path: 'package.json' }) },
      { id: 'c2', name: 'write_file' as const, arguments: JSON.stringify({ path: 'x.txt', content: 'a' }) },
      { id: 'c3', name: 'list_dir' as const, arguments: '{}' }
    ];
    const messages: unknown[] = [];
    const ok = await executeToolBatch('s1', 'full-access', calls, messages, cwd, new AbortController().signal, sink, makeRuntime());
    expect(ok.continueLoop).toBe(true);
    expect(messages.map(m => (m as { tool_call_id: string }).tool_call_id)).toEqual(['c1', 'c2', 'c3']);
    expect(done.map(e => e.toolCallId)).toEqual(['c1', 'c2', 'c3']);
  });

  it('plan 模式写工具被 gateTool 拒绝，任务停止', async () => {
    const calls = [{ id: 'c1', name: 'write_file' as const, arguments: JSON.stringify({ path: 'x.txt', content: 'a' }) }];
    const messages: unknown[] = [];
    const ok = await executeToolBatch('s1', 'plan', calls, messages, cwd, new AbortController().signal, noopSink(), makeRuntime());
    expect(ok.continueLoop).toBe(false);
    expect(messages.length).toBe(0);
  });

  it('已中止时直接返回 false 不执行工具', async () => {
    const controller = new AbortController();
    controller.abort();
    const calls = [{ id: 'c1', name: 'read_file' as const, arguments: '{}' }];
    const ok = await executeToolBatch('s1', 'full-access', calls, [], cwd, controller.signal, noopSink(), makeRuntime());
    expect(ok.continueLoop).toBe(false);
  });
});