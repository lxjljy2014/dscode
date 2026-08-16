import { describe, expect, it } from 'vitest';
import { executeTool, registerToolHooks } from '../src/tools';
import type { ToolResult } from '../src/tools';

/** 管线测试：pre/guard/around/post/onResult 各段扩展点行为 */
describe('工具执行管线（pre/guard/around/post/onResult）', () => {
  it('pre 拒绝：不进执行', async () => {
    const dispose = registerToolHooks({
      pre: async () => ({ error: 'pre 拒绝' }),
    });
    try {
      const r = await executeTool('list_dir', '{}', '/tmp');
      expect(r).toEqual({ ok: false, error: 'pre 拒绝' });
    } finally {
      dispose();
    }
  });

  it('guard 拒绝：返回原因', async () => {
    const dispose = registerToolHooks({
      guard: () => 'guard 拒绝',
    });
    try {
      const r = await executeTool('list_dir', '{}', '/tmp');
      expect(r).toEqual({ ok: false, error: 'guard 拒绝' });
    } finally {
      dispose();
    }
  });

  it('around 包装：包裹执行并放行（改结果验证）', async () => {
    const dispose = registerToolHooks({
      around: async (_exec, next) => {
        const result = await next();
        return { ok: true as const, content: '包装: ' + (result.ok ? result.content : result.error) };
      },
    });
    try {
      const r = await executeTool('list_dir', '{}', '/tmp');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.content.startsWith('包装: ')).toBe(true);
    } finally {
      dispose();
    }
  });

  it('post 改写结果', async () => {
    const dispose = registerToolHooks({
      post: async (_exec, _result) => ({ ok: true as const, content: 'post 改写' }),
    });
    try {
      const r = await executeTool('list_dir', '{}', '/tmp');
      expect(r).toEqual({ ok: true, content: 'post 改写' });
    } finally {
      dispose();
    }
  });

  it('onResult 观察：记录执行结果', async () => {
    const seen: ToolResult[] = [];
    const dispose = registerToolHooks({
      onResult: (_exec, result) => { seen.push(result); },
    });
    try {
      await executeTool('list_dir', '{}', '/tmp');
      expect(seen.length).toBe(1);
    } finally {
      dispose();
    }
  });

  it('多组钩子 post 反向执行（内层先见原始结果），dispose 后不再生效', async () => {
    const order: string[] = [];
    const d1 = registerToolHooks({ post: async (_e, r) => { order.push('h1'); return r; } });
    const d2 = registerToolHooks({ post: async (_e, r) => { order.push('h2'); return r; } });
    await executeTool('list_dir', '{}', '/tmp');
    // post 从内向外：后注册的先运行（h2 先见原始结果），与 DSH around/post 语义一致
    expect(order).toEqual(['h2', 'h1']);
    d1();
    d2();
    const order2: string[] = [];
    const d3 = registerToolHooks({ post: async (_e, r) => { order2.push('h3'); return r; } });
    await executeTool('list_dir', '{}', '/tmp');
    expect(order2).toEqual(['h3']);
    d3();
  });
});