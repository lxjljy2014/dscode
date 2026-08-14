import { describe, expect, it } from 'vitest';
import { AgentRuntime, approvalRuleMatches, approvalSignature, type AgentEventSink } from '../src';

/** AgentRuntime.start 启动前置校验（不触网）：错误码契约与 no-api-key 事件 */
const noopSink: AgentEventSink = {
  delta: () => {},
  tool: () => {},
  confirm: () => {},
  ruleUpdated: () => {},
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

describe('approvalSignature / approvalRuleMatches', () => {
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

  it('规则匹配：完全一致或前缀一致', () => {
    expect(approvalRuleMatches('run_command:git status', 'run_command:git status')).toBe(true);
    expect(approvalRuleMatches('run_command:git status --short', 'run_command:git status')).toBe(true);
    expect(approvalRuleMatches('run_command:git log', 'run_command:git status')).toBe(false);
  });
});
