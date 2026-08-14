/** MCP 工具摘要 */
export interface McpToolInfo {
  name: string;
  description: string;
}

/** MCP tools/list 结果（IPC 判别联合） */
export type McpListToolsResult =
  | { ok: true; tools: McpToolInfo[] }
  | { ok: false; error: string };
