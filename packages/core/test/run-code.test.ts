import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeTool, toolSchemas } from '../src/tools';

/** run_code 折叠：worker 执行程序 + 工具桥接 + Code Mode schema 切换 */
describe('run_code（Code Mode 折叠）', () => {
  it('Code Mode 下 toolSchemas 只暴露 run_code', () => {
    const schemas = toolSchemas(true, true) as Array<{ function: { name: string } }>;
    expect(schemas.length).toBe(1);
    expect(schemas[0]?.function.name).toBe('run_code');
  });

  it('普通模式 toolSchemas 包含 run_code 与其余工具', () => {
    const schemas = toolSchemas(true, false) as Array<{ function: { name: string } }>;
    const names = schemas.map(s => s.function.name);
    expect(names).toContain('run_code');
    expect(names).toContain('read_file');
  });

  it('worker 执行纯程序并返回 JSON 值', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dscode-rc-'));
    try {
      const code = 'const a = 1; const b = 2; return { sum: a + b, name: "hi" };';
      const r = await executeTool('run_code', JSON.stringify({ code, description: 'test sum' }), cwd);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.content).toContain('3');
        expect(r.content).toContain('hi');
      }
    } finally {
      await import('node:fs/promises').then(m => m.rm(cwd, { recursive: true, force: true }));
    }
  });

  it('程序内调用 tools.read_file 桥接回主线程', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dscode-rc-'));
    await writeFile(join(cwd, 'a.txt'), 'hello world', 'utf8');
    try {
      const code = 'const content = await tools.read_file({ path: "a.txt" }); return { read: content.includes("hello") };';
      const r = await executeTool('run_code', JSON.stringify({ code, description: 'test read' }), cwd);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.content).toContain('true');
    } finally {
      await import('node:fs/promises').then(m => m.rm(cwd, { recursive: true, force: true }));
    }
  });

  it('程序抛错返回结构化错误', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dscode-rc-'));
    try {
      const code = 'throw new Error("boom");';
      const r = await executeTool('run_code', JSON.stringify({ code, description: 'test throw' }), cwd);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('boom');
    } finally {
      await import('node:fs/promises').then(m => m.rm(cwd, { recursive: true, force: true }));
    }
  });
});
