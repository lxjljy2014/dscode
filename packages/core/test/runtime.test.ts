import { describe, expect, it } from 'vitest';
import { AgentRuntime, type AgentEventSink } from '../src';

/** AgentRuntime.start 启动前置校验（不触网）：错误码契约与 no-api-key 事件 */
const noopSink: AgentEventSink = {
  delta: () => {},
  tool: () => {},
  confirm: () => {},
  usage: () => {},
  done: () => {},
  error: () => {},
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
