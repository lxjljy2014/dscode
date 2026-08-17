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

/** 拦截本机/内网/链路本地地址，防 SSRF（模型被诱导访问 169.254.169.254 等） */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '0.0.0.0' || h === '::' || h === '::1') return true;
  // IPv6 链路本地（fe80::/10）与唯一本地地址 ULA（fc00::/7）
  if (/^fe80:/i.test(h) || /^f[cd][0-9a-f]{2}:/i.test(h)) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/** 抓取网页并转为可读文本（browse 工具与 IPC 测试共用）；signal 用于运行中止时打断请求 */
export async function fetchWebPage(url: string, signal?: AbortSignal): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('非法 URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('仅支持 http/https');
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error('不允许访问本机/内网地址');
  }
  const res = await fetch(url, {
    headers: { 'user-agent': 'DSCode/0.0' },
    ...(signal ? { signal } : {})
  });
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
  async execute(args, ctx): Promise<ToolResult> {
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
      const text = await fetchWebPage(url, ctx.signal);
      return { ok: true, content: text, meta: { url, chars: text.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
});