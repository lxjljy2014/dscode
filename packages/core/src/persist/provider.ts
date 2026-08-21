import type { ProviderVerifyResult } from '@dscode/shared';
import { isPrivateHost } from '../net/ssrf';

/**
 * AI 供应商 API key 校验（OpenAI 兼容：GET {baseUrl}/models + Bearer）。
 * 渲染端受 CSP default-src 'self' 限制无法直连外部 API，校验请求走主进程 fetch。
 * 校验通过时顺带解析模型列表（data[].id），供「验证并导入模型」一键填充。
 */

const VERIFY_TIMEOUT_MS = 10000;

/** 回环主机名（http 仅对它们放行：本地推理服务 Ollama/LM Studio 等是正当场景，回环不构成内网横向探测面） */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** 从 {baseUrl}/models 响应解析 OpenAI 格式的模型名列表（data[].id）；非预期结构返回 undefined */
function parseModels(body: unknown): string[] | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return undefined;
  const ids = data
    .map(item => (typeof item === 'object' && item !== null ? (item as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  return ids.length > 0 ? ids : undefined;
}

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
  // 协议白名单：https 任意非内网主机；http 仅放行回环字面量（本地推理服务）。
  // 其余一律拒绝（防渲染端把主进程当 SSRF 代理探测内网服务）
  const isLoopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol === 'https:') {
    if (isPrivateHost(url.hostname)) return { ok: false, reason: 'invalid-args' };
  } else if (url.protocol === 'http:') {
    // 注意 isPrivateHost 把回环也判私网，此处不能再叠加：仅按回环字面量放行
    if (!isLoopback) return { ok: false, reason: 'invalid-args' };
  } else {
    return { ok: false, reason: 'invalid-args' };
  }
  url.pathname = url.pathname.replace(/\/+$/, '') + '/models';

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS)
    });
    if (res.status === 200) {
      // 拉取模型列表：解析失败（非 OpenAI 格式）不影响校验结论，仅不带 models
      try {
        const models = parseModels(await res.json());
        return models ? { ok: true, models } : { ok: true };
      } catch {
        return { ok: true };
      }
    }
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'unauthorized' };
    return { ok: false, reason: 'network' };
  } catch {
    // 超时 / DNS / TLS / 连接失败等一律归为网络异常
    return { ok: false, reason: 'network' };
  }
}
