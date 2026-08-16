import { describe, expect, it, vi } from 'vitest';
import { afterEach } from 'vitest';
import { AgentRuntime } from '../src';

function noopSink() {
  return {
    delta: () => {}, tool: () => {}, confirm: () => {}, usage: () => {},
    done: () => {}, error: () => {}, sessionStats: () => {}, diff: () => {}
  };
}

function sseChunk(toolCalls) {
  const delta = { choices: [{ delta: { tool_calls: toolCalls.map((tc, index) => ({
    index, id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments }
  })) } }] };
  const frame = `data: ${JSON.stringify(delta)}\n\ndata: [DONE]\n\n`;
  return new TextEncoder().encode(frame);
}

function mockSseResponse(chunks) {
  let i = 0;
  const reader = new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]);
      else controller.close();
    }
  });
  return { ok: true, body: reader };
}

describe('端到端：工具事件携带 meta/blocks', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('run_command done 事件带 exitCode meta', async () => {
    // 模型第一轮调 run_command，第二轮无工具（结束）
    const rounds = [
      sseChunk([{ id: 'c1', name: 'run_command', arguments: JSON.stringify({ command: 'echo hi' }) }]),
      sseChunk([]),
    ];
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => mockSseResponse([rounds[call++]])));

    const doneEvents = [];
    const sink = {
      ...noopSink(),
      tool: (_sid, e) => { if (e.status === 'done') doneEvents.push(e); },
    };

    const rt = new AgentRuntime();
    await rt.start({
      sessionId: 's1', model: 'm1', rawMessages: [], sink,
      config: {
        workingDirectory: process.cwd(),
        permissionMode: 'full-access',
        providers: [{ id: 'p', name: 'P', baseUrl: 'https://api.example.com', apiKey: 'k', models: ['m1'] }],
      },
    });
    await vi.waitFor(() => expect(doneEvents.length).toBeGreaterThan(0), { timeout: 5000 });
    const ev = doneEvents[0];
    console.log('DONE EVENT:', JSON.stringify(ev));
    expect(ev.meta).toBeDefined();
    expect(ev.meta?.['exitCode']).toBe(0);
  }, 15000);
});