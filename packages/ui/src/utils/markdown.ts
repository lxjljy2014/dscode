import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';

/**
 * Markdown 渲染（聊天 assistant 正文）：
 * - GFM 基础能力（标题/列表/引用/链接/表格/代码块），禁用原始 HTML
 * - 代码块经 highlight.js 高亮（common 子集控制体积），未知语言转义输出
 * - 代码块带 header（左侧语言、右侧复制/下载）+ 左侧行号
 * - 单例实例：流式期间逐 chunk 重渲染，markdown-it 解析速度足够（原型规模）
 */

/** 语言 → 文件扩展名（下载文件名用） */
const LANG_EXT: Record<string, string> = {
  javascript: 'js', js: 'js', jsx: 'jsx', mjs: 'mjs', cjs: 'cjs',
  typescript: 'ts', ts: 'ts', tsx: 'tsx',
  python: 'py', py: 'py',
  java: 'java', c: 'c', cpp: 'cpp', 'c++': 'cpp', h: 'h',
  csharp: 'cs', cs: 'cs', go: 'go', rust: 'rs', ruby: 'rb', php: 'php',
  swift: 'swift', kotlin: 'kt', scala: 'scala',
  html: 'html', xml: 'xml', css: 'css', scss: 'scss', less: 'less',
  json: 'json', yaml: 'yml', yml: 'yml', toml: 'toml',
  markdown: 'md', md: 'md',
  bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh', powershell: 'ps1', ps1: 'ps1',
  sql: 'sql', graphql: 'graphql',
  dockerfile: 'dockerfile', diff: 'diff', plaintext: 'txt', text: 'txt',
  vue: 'vue', svelte: 'svelte', astro: 'astro'
};

/** 语言 → 高亮别名（highlight.js common 子集未收录的语言回退到相近语法） */
const HIGHLIGHT_ALIAS: Record<string, string> = {
  vue: 'xml',
  svelte: 'xml',
  astro: 'xml'
};

const md = new MarkdownIt({ html: false, linkify: true });

/** 生成带 header + 行号的代码块 HTML（语言标签 + 复制/下载按钮 + 高亮代码） */
function renderCodeBlock(code: string, lang: string, t?: (key: string) => string): string {
  const langName = (lang || '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  const hlLang = HIGHLIGHT_ALIAS[langName] ?? langName;
  // 去掉末尾单个换行（fence 结束前那一个），保证行号与代码行数一致
  const codeText = code.replace(/\n$/, '');
  let codeHtml: string;
  if (hlLang && hljs.getLanguage(hlLang)) {
    try {
      codeHtml = hljs.highlight(codeText, { language: hlLang }).value;
    } catch {
      codeHtml = md.utils.escapeHtml(codeText);
    }
  } else {
    codeHtml = md.utils.escapeHtml(codeText);
  }
  const lineCount = codeText.split('\n').length;
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => String(i + 1)).join('\n');
  const ext = LANG_EXT[langName] ?? 'txt';
  const label = langName || 'text';
  const copyTitle = md.utils.escapeHtml(t?.('chat.copyCode') ?? '复制代码');
  const downloadTitle = md.utils.escapeHtml(t?.('chat.downloadCode') ?? '下载代码');
  return [
    '<div class="ds-codeblock">',
    '  <div class="ds-codeblock__header">',
    '    <span class="ds-codeblock__lang">' + md.utils.escapeHtml(label) + '</span>',
    '    <div class="ds-codeblock__actions">',
    '      <button type="button" class="ds-codeblock__btn" data-action="copy" title="' + copyTitle + '"><span class="i-lucide:copy"></span></button>',
    '      <button type="button" class="ds-codeblock__btn" data-action="download" data-filename="code.' + ext + '" title="' + downloadTitle + '"><span class="i-lucide:download"></span></button>',
    '    </div>',
    '  </div>',
    '  <div class="ds-codeblock__body">',
    '    <span class="ds-codeblock__ln" aria-hidden="true">' + lineNumbers + '</span>',
    '    <pre class="hljs"><code>' + codeHtml + '</code></pre>',
    '  </div>',
    '</div>',
    ''
  ].join('\n');
}

// 围栏代码块：带 header（语言 + 复制/下载）+ 行号
md.renderer.rules.fence = (tokens, idx, _options, env) => {
  const token = tokens[idx];
  const info = token.info ? token.info.trim() : '';
  const t = (env as { t?: (key: string) => string } | undefined)?.t;
  return renderCodeBlock(token.content, info, t);
};

// 外部链接统一新窗口打开（Electron setWindowOpenHandler 会转交系统浏览器）+ noopener 防反向链接；
// 相对/锚点链接保持窗口内跳转
const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const href = String(token?.attrGet('href') ?? '');
  if (/^https?:/i.test(href)) {
    token?.attrSet('target', '_blank');
    token?.attrSet('rel', 'noopener noreferrer');
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

export function renderMarkdown(text: string, t?: (key: string) => string): string {
  return md.render(text, { t });
}
