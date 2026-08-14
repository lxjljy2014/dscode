import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPlugins } from '../src/plugins/loader';

const dir = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures/plugins');

describe('loadPlugins', () => {
  it('加载合法插件及其命令，跳过非法插件', async () => {
    const plugins = await loadPlugins(dir);
    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.id).toBe('example');
    expect(plugins[0]?.commands).toHaveLength(1);
    expect(plugins[0]?.commands?.[0]?.name).toBe('explain');
  });

  it('目录不存在返回空数组', async () => {
    expect(await loadPlugins('/definitely/not/exist/xyz')).toEqual([]);
  });
});
