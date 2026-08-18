import { MAX_OUTPUT_CHARS } from '../constants';
import { isPrivateHost } from '../net/ssrf';
import { defineTool } from './schema';
import type { ToolResult } from './types';

const MAX_WEB_BYTES = 2 * 1024 * 1024;
/** 最多跟随的重定向跳数 */
const MAX_REDIRECTS = 5;
/** 单次抓取默认超时（毫秒） */
const FETCH_TIMEOUT_MS = 30_000;

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

/** 校验协议与公网主机（防 SSRF） */
function assertPublicUrl(parsed: URL): void {
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('仅支持 http/https');
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error('不允许访问本机/内网地址');
  }
}

/** 逐跳跟随重定向并复核每个目标主机，防 302 跳到内网绕过 SSRF 校验 */
async function fetchWithRedirectGuard(url: string, signal: AbortSignal): Promise<Response> {
  let current = url;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const parsed = new URL(current);
    assertPublicUrl(parsed);
    const res = await fetch(current, {
      redirect: 'manual',
      headers: { 'user-agent': 'DSCode/0.0' },
      signal
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error('重定向次数过多');
}

/** 抓取网页并转为可读文本（browse 工具与 IPC 测试共用）；signal 用于运行中止时打断请求 */
export async function fetchWebPage(url: string, signal?: AbortSignal): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('非法 URL');
  }
  assertPublicUrl(parsed);
  // 默认 30s 超时，与调用方 signal 合成（慢服务器不再无限阻塞本轮工具调度）
  const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const res = await fetchWithRedirectGuard(url, combined);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('text/html') && !type.includes('text/plain')) {
    throw new Error('不支持的响应类型：' + type);
  }
  // 按字节流式读取并封顶，不依赖可能缺失/失真的 content-length（分块传输时同样生效）
  if (!res.body) throw new Error('响应无正文');
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.byteLength > 0) {
      total += value.byteLength;
      if (total > MAX_WEB_BYTES) throw new Error('网页过大（>2MB）');
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  const raw = new TextDecoder().decode(bytes);
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