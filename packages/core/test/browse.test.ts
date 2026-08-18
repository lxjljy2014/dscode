import { afterEach, describe, expect, it, vi } from 'vitest';
import { browseTool, fetchWebPage } from '../src/tools/browse';

afterEach(() => vi.unstubAllGlobals());

/** 构造带 body.getReader() 的响应 mock（fetchWebPage 按流式字节读取并封顶） */
function textResponse(status: number, bodyText: string, headers: Record<string, string> = {}) {
  const bytes = new TextEncoder().encode(bodyText);
  const get = (k: string): string | null => headers[k.toLowerCase()] ?? null;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get },
    body: {
      getReader: () => {
        let done = false;
        return { read: async () => (done ? { done: true, value: undefined } : ((done = true), { done: false, value: bytes })) };
      }
    }
  };
}

describe('fetchWebPage', () => {
  it('抓取 HTML 并剥离标签/脚本/样式、解码实体', async () => {
    const html =
      '<html><head><script>var x=1;</script><style>body{}</style></head><body><h1>Hello</h1><p>World &amp; more</p></body></html>';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(textResponse(200, html, { 'content-type': 'text/html; charset=utf-8' })));
    const text = await fetchWebPage('https://example.com');
    expect(text).toContain('Hello');
    expect(text).toContain('World & more');
    expect(text).not.toContain('<h1>');
    expect(text).not.toContain('var x');
  });

  it('非 2xx 抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(textResponse(404, '')));
    await expect(fetchWebPage('https://example.com')).rejects.toThrow('HTTP 404');
  });

  it('拒绝本机/内网/映射地址', async () => {
    await expect(fetchWebPage('http://169.254.169.254')).rejects.toThrow('不允许访问本机/内网地址');
    await expect(fetchWebPage('http://localhost:8080')).rejects.toThrow('不允许访问本机/内网地址');
    await expect(fetchWebPage('http://[::ffff:127.0.0.1]')).rejects.toThrow('不允许访问本机/内网地址');
  });

  it('公网 URL 重定向到内网时被拦截', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(textResponse(302, '', { location: 'http://169.254.169.254/latest/meta-data' }))
    );
    await expect(fetchWebPage('https://example.com/a')).rejects.toThrow('不允许访问本机/内网地址');
  });
});

describe('browseTool', () => {
  it('拒绝非 http/https 协议', async () => {
    const r = await browseTool.execute({ url: 'ftp://example.com' }, { cwd: '/' });
    expect(r.ok).toBe(false);
  });

  it('拒绝非法 URL', async () => {
    const r = await browseTool.execute({ url: 'not a url' }, { cwd: '/' });
    expect(r.ok).toBe(false);
  });

  it('缺少 url 参数返回错误', async () => {
    const r = await browseTool.execute({}, { cwd: '/' });
    expect(r.ok).toBe(false);
  });
});
