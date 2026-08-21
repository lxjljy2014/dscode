import { createInterface } from 'node:readline';

// 最小 MCP stdio 服务器：响应 initialize / tools/list / tools/call，其余返回空结果。
// hello 带参数 schema（供 agent 工具构建测试）；echo 回显调用参数（供 tools/call 往返测试）。
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
    respond(msg.id, {
      tools: [
        { name: 'hello', description: 'say hello' },
        {
          name: 'echo',
          description: 'echo back',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string', description: '要回显的文本' } },
            required: ['text']
          }
        },
        {
          name: 'fail',
          description: 'always fails',
          inputSchema: 'not-a-valid-schema'
        }
      ]
    });
  } else if (msg.method === 'tools/call') {
    if (msg.params?.name === 'echo') {
      respond(msg.id, {
        content: [{ type: 'text', text: `echo: ${msg.params?.arguments?.text ?? ''}` }]
      });
    } else if (msg.params?.name === 'fail') {
      respond(msg.id, { content: [{ type: 'text', text: 'boom' }], isError: true });
    } else {
      respond(msg.id, { content: [{ type: 'text', text: 'hi' }] });
    }
  } else {
    respond(msg.id, {});
  }
});
