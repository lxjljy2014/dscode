import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';

/**
 * Markdown 渲染（聊天 assistant 正文）：
 * - GFM 基础能力（标题/列表/引用/链接/表格/代码块），禁用原始 HTML
 * - 代码块经 highlight.js 高亮（common 子集控制体积），未知语言转义输出
 * - 单例实例：流式期间逐 chunk 重渲染，markdown-it 解析速度足够（原型规模）
 */

const md = new MarkdownIt({
  html: false,
  linkify: true,
  highlight(code: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(code, { language: lang }).value}</code></pre>`;
      } catch {
        // 高亮失败回落为转义代码块
      }
    }
    return `<pre><code>${md.utils.escapeHtml(code)}</code></pre>`;
  }
});

export function renderMarkdown(text: string): string {
  return md.render(text);
}
