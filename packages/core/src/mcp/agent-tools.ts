import type { McpServer } from '@dscode/shared';
import type { Tool, ToolResult } from '../tools';
import { callMcpTool, getMcpConnection } from './client';

/**
 * MCP 工具 → agent 动态工具：把已配置 MCP 服务器的 tools/list 结果包装为
 * 可注入工具循环的 Tool（命名 mcp__<serverId>__<toolName>），执行走连接池 tools/call。
 * 权限默认 write（外部工具副作用不可预知，统一走确认门控）；单服务器加载失败仅跳过。
 */

/** MCP 工具调用超时（tools/call 单次） */
const MCP_TOOL_TIMEOUT_MS = 60_000;

/** 动态工具名（UI 展示与执行查表共用此格式） */
export function mcpToolName(serverId: string, toolName: string): string {
  return `mcp__${serverId}__${toolName}`;
}

/** JSON Schema → Tool.parameters（防御式归一化：非法结构退化为空对象 schema） */
export function normalizeInputSchema(schema: unknown): Tool['parameters'] {
  if (typeof schema !== 'object' || schema === null) return { type: 'object', properties: {} };
  const s = schema as { properties?: unknown; required?: unknown };
  const properties =
    typeof s.properties === 'object' && s.properties !== null ? (s.properties as Record<string, unknown>) : {};
  const required = Array.isArray(s.required) ? s.required.filter((x): x is string => typeof x === 'string') : undefined;
  return { type: 'object', properties, ...(required !== undefined ? { required } : {}) };
}

/** tools/call 结果的 content 数组 → 纯文本（text 项拼接） */
function contentText(result: Record<string, unknown>): string {
  const content = result['content'];
  if (Array.isArray(content)) {
    return content
      .filter(c => typeof c === 'object' && c !== null && (c as { type?: unknown }).type === 'text')
      .map(c => String((c as { text?: unknown }).text ?? ''))
      .join('\n');
  }
  return typeof content === 'string' ? content : '';
}

/** tools/call 结果 → ToolResult（isError=true 映射为失败结果） */
export function mcpResultToToolResult(result: Record<string, unknown>): ToolResult {
  const text = contentText(result);
  if (result['isError'] === true) {
    return { ok: false, error: text || 'MCP 工具返回错误' };
  }
  return { ok: true, content: text || '（空结果）' };
}

/**
 * 构建全部已配置 MCP 服务器的动态工具表。
 * 单个服务器连接/列举失败时跳过（console.warn），不影响其它服务器与内置工具。
 */
export async function buildMcpTools(servers: readonly McpServer[]): Promise<Tool[]> {
  const tools: Tool[] = [];
  await Promise.all(
    servers.map(async server => {
      try {
        const list = await getMcpConnection(server).listTools(10_000);
        for (const info of list) {
          if (!info.name) continue;
          const originalName = info.name;
          tools.push({
            name: mcpToolName(server.id, originalName),
            permission: 'write',
            description: `[MCP:${server.name}] ${info.description || originalName}`,
            parameters: normalizeInputSchema(info.inputSchema),
            timeoutMs: MCP_TOOL_TIMEOUT_MS,
            async execute(args): Promise<ToolResult> {
              const result = await callMcpTool(server, originalName, args, MCP_TOOL_TIMEOUT_MS);
              return mcpResultToToolResult(result);
            }
          });
        }
      } catch (e) {
        console.warn(`[dscode] MCP 服务器「${server.name}」工具加载失败，已跳过：`, e instanceof Error ? e.message : e);
      }
    })
  );
  return tools;
}
