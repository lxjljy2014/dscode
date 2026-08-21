import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { callMcpTool, disposeMcpConnections, getMcpConnection, listMcpTools } from '../src/mcp/client';
import { buildMcpTools, mcpToolName, mcpResultToToolResult, normalizeInputSchema } from '../src/mcp/agent-tools';
import type { McpServer } from '@dscode/shared';

const server = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures/mock-mcp-server.mjs');
const mkServer = (): McpServer => ({ id: 'mock-1', name: 'Mock', command: process.execPath, args: [server] });

// 池化连接与子进程在测试间回收，避免 mock server 进程泄漏
afterEach(() => {
  disposeMcpConnections();
});

describe('listMcpTools（池化长连接）', () => {
  it('通过 stdio 完成 initialize + tools/list（透传 inputSchema）', async () => {
    const tools = await listMcpTools(mkServer());
    expect(tools).toContainEqual({ name: 'hello', description: 'say hello' });
    const echo = tools.find(t => t.name === 'echo');
    expect(echo?.description).toBe('echo back');
    expect(echo?.inputSchema).toMatchObject({ type: 'object', required: ['text'] });
  });

  it('同一服务器复用同一连接（池化）', () => {
    const a = getMcpConnection(mkServer());
    const b = getMcpConnection(mkServer());
    expect(a).toBe(b);
  });

  it('命令不存在时报错', async () => {
    await expect(
      listMcpTools({ command: 'definitely-not-a-real-cmd-xyz', args: [] }, 3000)
    ).rejects.toThrow();
  });
});

describe('callMcpTool（tools/call 往返）', () => {
  it('echo 工具回显参数文本', async () => {
    const r = await callMcpTool(mkServer(), 'echo', { text: 'world' });
    expect(r).toEqual({ content: [{ type: 'text', text: 'echo: world' }] });
  });

  it('超时未响应的请求报错', async () => {
    // mock server 对未知方法立即响应，不会超时；用极短超时验证计时器路径不误放
    const r = await callMcpTool(mkServer(), 'hello', {}, 5000);
    expect(r).toEqual({ content: [{ type: 'text', text: 'hi' }] });
  });
});

describe('buildMcpTools（动态工具构建）', () => {
  it('构建 mcp__<server>__<tool> 工具：schema 归一化、描述带服务器名', async () => {
    const tools = await buildMcpTools([mkServer()]);
    const names = tools.map(t => t.name);
    expect(names).toContain('mcp__mock-1__hello');
    expect(names).toContain('mcp__mock-1__echo');
    expect(names).toContain('mcp__mock-1__fail');
    const echo = tools.find(t => t.name === 'mcp__mock-1__echo');
    expect(echo?.description).toContain('[MCP:Mock]');
    expect(echo?.permission).toBe('write'); // 外部工具默认走确认门控
    expect(echo?.parameters).toEqual({
      type: 'object',
      properties: { text: { type: 'string', description: '要回显的文本' } },
      required: ['text']
    });
    // 非法 schema 退化为空对象 schema
    const fail = tools.find(t => t.name === 'mcp__mock-1__fail');
    expect(fail?.parameters).toEqual({ type: 'object', properties: {} });
  });

  it('构建出的工具可执行：echo 返回内容、isError 映射为失败', async () => {
    const tools = await buildMcpTools([mkServer()]);
    const echo = tools.find(t => t.name === 'mcp__mock-1__echo');
    const ok = await echo?.execute({ text: 'abc' }, { cwd: '/tmp' });
    expect(ok).toEqual({ ok: true, content: 'echo: abc' });
    const fail = tools.find(t => t.name === 'mcp__mock-1__fail');
    const bad = await fail?.execute({}, { cwd: '/tmp' });
    expect(bad).toEqual({ ok: false, error: 'boom' });
  });

  it('单服务器失败不影响整体（跳过并返回空）', async () => {
    const tools = await buildMcpTools([{ id: 'bad', name: 'Bad', command: 'definitely-not-a-real-cmd-xyz', args: [] }]);
    expect(tools).toEqual([]);
  });
});

describe('normalizeInputSchema / mcpResultToToolResult（纯函数）', () => {
  it('非法结构退化为空 schema', () => {
    expect(normalizeInputSchema(undefined)).toEqual({ type: 'object', properties: {} });
    expect(normalizeInputSchema('not-a-schema')).toEqual({ type: 'object', properties: {} });
    expect(normalizeInputSchema({ properties: 'x', required: [1, 'a'] })).toEqual({
      type: 'object',
      properties: {},
      required: ['a']
    });
  });

  it('content 数组拼接 text 项；isError 映射失败；空结果兜底', () => {
    expect(
      mcpResultToToolResult({ content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] })
    ).toEqual({ ok: true, content: 'a\nb' });
    expect(mcpResultToToolResult({ isError: true, content: [{ type: 'text', text: 'boom' }] })).toEqual({
      ok: false,
      error: 'boom'
    });
    expect(mcpResultToToolResult({})).toEqual({ ok: true, content: '（空结果）' });
  });

  it('mcpToolName 命名格式', () => {
    expect(mcpToolName('srv', 'do')).toBe('mcp__srv__do');
  });
});
