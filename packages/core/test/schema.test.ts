import { describe, expect, it } from 'vitest';
import { defineTool, parameterSchemaToOpenAi } from '../src/tools/schema';

describe('parameterSchemaToOpenAi（schema DSL 编译）', () => {
  it('required 属性编译为 required 数组', () => {
    const params = parameterSchemaToOpenAi({
      path: { type: 'string', description: '路径', required: true },
      count: { type: 'number' },
    });
    expect(params.type).toBe('object');
    expect(params.required).toEqual(['path']);
    expect((params.properties['path'] as { type?: string }).type).toBe('string');
    expect((params.properties['path'] as { description?: string }).description).toBe('路径');
    expect((params.properties['count'] as { type?: string }).type).toBe('number');
  });

  it('数组/嵌套对象递归编译', () => {
    const params = parameterSchemaToOpenAi({
      tags: { type: 'array', items: { type: 'string' } },
      meta: { type: 'object', properties: { name: { type: 'string' } } },
    });
    expect((params.properties['tags'] as { items?: { type?: string } }).items?.type).toBe('string');
    const meta = params.properties['meta'] as { properties?: Record<string, { type?: string }> };
    expect(meta.properties?.['name']?.type).toBe('string');
  });

  it('无 required 时不带 required 字段', () => {
    const params = parameterSchemaToOpenAi({ path: { type: 'string' } });
    expect(params.required).toBeUndefined();
  });
});

describe('InferArgs（类型推断，编译期验证）', () => {
  it('required 必填、可选可选（类型层）', () => {
    const tool = defineTool({
      name: 'read_file',
      permission: 'read',
      description: 'x',
      parameters: {
        path: { type: 'string', required: true },
        offset: { type: 'number' },
      },
      execute: async (args) => {
        // 编译期类型：path 为 string，offset 为 number|undefined
        const p: string = args.path;
        const o: number | undefined = args.offset;
        void p; void o;
        return { ok: true as const, content: 'ok' };
      },
    });
    expect(tool.name).toBe('read_file');
    expect(tool.parameters.required).toEqual(['path']);
  });
});