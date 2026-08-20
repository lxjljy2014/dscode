import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/utils/markdown';

/** markdown 渲染：代码块 header/行号/高亮、外链 noopener、原始 HTML 转义 */

describe('renderMarkdown', () => {
  it('代码块带 header（语言标签/复制/下载按钮）与行号', () => {
    const html = renderMarkdown('```ts\nconst a = 1;\nconst b = 2;\n```');
    expect(html).toContain('ds-codeblock');
    expect(html).toContain('ds-codeblock__lang');
    expect(html).toContain('ts');
    expect(html).toContain('data-action="copy"');
    expect(html).toContain('data-action="download"');
    expect(html).toContain('data-filename="code.ts"');
    // 行号两行
    expect(html).toContain('ds-codeblock__ln');
    const ln = html.match(/ds-codeblock__ln[^>]*>([\s\S]*?)<\/span>/);
    expect(ln?.[1]?.trim().split('\n')).toEqual(['1', '2']);
  });

  it('代码高亮：关键字带 hljs span', () => {
    const html = renderMarkdown('```js\nconst a = 1;\n```');
    expect(html).toContain('hljs');
    expect(html).toContain('<span class="hljs-keyword">');
  });

  it('未知语言：转义不高亮但仍渲染代码块', () => {
    const html = renderMarkdown('```mylang\nplain <text>\n```');
    expect(html).toContain('ds-codeblock');
    expect(html).toContain('&lt;text&gt;');
    expect(html).not.toContain('hljs-keyword');
  });

  it('http(s) 外链强制 _blank + noopener noreferrer', () => {
    const html = renderMarkdown('[link](https://example.com)');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('相对链接不加 target', () => {
    const html = renderMarkdown('[doc](./readme.md)');
    expect(html).not.toContain('target="_blank"');
  });

  it('原始 HTML 被转义（html:false 防 XSS）', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('内联代码与加粗等基础 GFM 能力', () => {
    const html = renderMarkdown('`code` and **bold**');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('t 回调注入复制/下载按钮文案', () => {
    const html = renderMarkdown('```ts\nx\n```', key => (key === 'chat.copyCode' ? 'COPY IT' : 'DL'));
    expect(html).toContain('title="COPY IT"');
    expect(html).toContain('title="DL"');
  });
});
