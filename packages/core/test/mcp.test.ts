import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listMcpTools } from '../src/mcp/client';

const server = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures/mock-mcp-server.mjs');

describe('listMcpTools', () => {
  it('通过 stdio 完成 initialize + tools/list', async () => {
    const tools = await listMcpTools({ command: process.execPath, args: [server] });
    expect(tools).toEqual([{ name: 'hello', description: 'say hello' }]);
  });

  it('命令不存在时报错', async () => {
    await expect(listMcpTools({ command: 'definitely-not-a-real-cmd-xyz', args: [] }, 3000)).rejects.toThrow();
  });
});
