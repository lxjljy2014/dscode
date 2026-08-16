import { MAX_OUTPUT_CHARS } from '../constants';
import { defineTool } from './schema';
import type { ToolResult } from './types';

const MAX_WEB_BYTES = 2 * 1024 * 1024;

/** 简易 HTML → 文本：去脚本/样式/标签，解码常见实体 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** 抓取网页并转为可读文本（browse 工具与 IPC 测试共用） */
export async function fetchWebPage(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': 'DSCode/0.0' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('text/html') && !type.includes('text/plain')) {
    throw new Error('不支持的响应类型：' + type);
  }
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_WEB_BYTES) throw new Error('网页过大（>2MB）');
  const raw = await res.text();
  const text = stripHtml(raw);
  return text.length > MAX_OUTPUT_CHARS ? text.slice(0, MAX_OUTPUT_CHARS) + '…(已截断)' : text;
}

export const browseTool = defineTool({
  name: 'browse',
  permission: 'read',
  concurrency: 'parallel',
  description: '抓取一个网页 URL 并返回其可读文本内容（用于查阅文档/资料）。仅支持 http/https。',
  parameters: {
    url: { type: 'string', description: '要抓取的完整 URL（http/https）', required: true },
  },
  async execute(args, _ctx): Promise<ToolResult> {
    const url = args.url;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, error: '非法 URL' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: '仅支持 http/https' };
    }
    try {
      const text = await fetchWebPage(url);
      return { ok: true, content: text, meta: { url, chars: text.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
});