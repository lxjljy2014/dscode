import { createInterface } from 'node:readline';

// 最小 MCP stdio 服务器：响应 initialize / tools/list，其余返回空结果。
const rl = createInterface({ input: process.stdin });

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

rl.on('line', line => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (typeof msg.id !== 'number') return;
  if (msg.method === 'initialize') {
    respond(msg.id, {
      protocolVersion: '2024-11-05',
      capabilities: {},
      serverInfo: { name: 'mock', version: '1.0' }
    });
  } else if (msg.method === 'tools/list') {
    respond(msg.id, { tools: [{ name: 'hello', description: 'say hello' }] });
  } else {
    respond(msg.id, {});
  }
});
