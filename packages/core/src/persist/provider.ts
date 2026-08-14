import type { ProviderVerifyResult } from '@dscode/shared';

/**
 * AI 供应商 API key 校验（OpenAI 兼容：GET {baseUrl}/models + Bearer）。
 * 渲染端受 CSP default-src 'self' 限制无法直连外部 API，校验请求走主进程 fetch。
 */

const VERIFY_TIMEOUT_MS = 10000;

export async function verifyProvider(baseUrl: unknown, apiKey: unknown): Promise<ProviderVerifyResult> {
  if (typeof baseUrl !== 'string' || typeof apiKey !== 'string' || apiKey.length === 0) {
    return { ok: false, reason: 'invalid-args' };
  }
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { ok: false, reason: 'invalid-args' };
  }
  // 只允许 https，避免被引导到任意协议/主机外探测
  if (url.protocol !== 'https:') return { ok: false, reason: 'invalid-args' };
  url.pathname = url.pathname.replace(/\/+$/, '') + '/models';

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS)
    });
    if (res.status === 200) return { ok: true };
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'unauthorized' };
    return { ok: false, reason: 'network' };
  } catch {
    // 超时 / DNS / TLS / 连接失败等一律归为网络异常
    return { ok: false, reason: 'network' };
  }
}
