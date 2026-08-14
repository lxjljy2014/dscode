import { afterEach, describe, expect, it, vi } from 'vitest';
import { browseTool, fetchWebPage } from '../src/tools/browse';

afterEach(() => vi.unstubAllGlobals());

describe('fetchWebPage', () => {
  it('抓取 HTML 并剥离标签/脚本/样式、解码实体', async () => {
    const html =
      '<html><head><script>var x=1;</script><style>body{}</style></head><body><h1>Hello</h1><p>World &amp; more</p></body></html>';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'text/html; charset=utf-8' },
        text: async () => html
      })
    );
    const text = await fetchWebPage('https://example.com');
    expect(text).toContain('Hello');
    expect(text).toContain('World & more');
    expect(text).not.toContain('<h1>');
    expect(text).not.toContain('var x');
  });

  it('非 2xx 抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(fetchWebPage('https://example.com')).rejects.toThrow('HTTP 404');
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
