import hljs from 'highlight.js/lib/common';

/**
 * 语法高亮工具：diff 面板行级高亮与文件预览整块高亮共用。
 * 行级高亮独立解析每行（丢失跨行语法上下文，如多行字符串），对关键字/字符串/数字等
 * 绝大多数代码行效果足够；未识别语言一律转义为纯文本。
 */

/** 文件扩展名 → highlight.js 语言名（common 子集内） */
const EXT_LANG: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  vue: 'xml', html: 'xml', xml: 'xml', svg: 'xml',
  css: 'css', scss: 'scss', less: 'less',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'ini',
  md: 'markdown', markdown: 'markdown',
  py: 'python', rb: 'ruby', php: 'php', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
  cs: 'csharp', go: 'go', rs: 'rust', swift: 'swift', kt: 'kotlin', scala: 'scala',
  sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell',
  sql: 'sql', graphql: 'graphql', gql: 'graphql', diff: 'diff', patch: 'diff'
};

/** 从文件路径解析高亮语言（扩展名匹配；未知返回空串） */
export function langFromPath(path: string): string {
  const name = path.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return name.toLowerCase() === 'dockerfile' || name.toLowerCase() === 'makefile' ? name.toLowerCase() : '';
  return EXT_LANG[name.slice(dot + 1).toLowerCase()] ?? '';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 高亮单行代码（diff 行渲染用）：未识别语言转义为纯文本 */
export function highlightLine(code: string, lang: string): string {
  if (!lang || !hljs.getLanguage(lang)) return escapeHtml(code);
  try {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

/** 整块代码高亮（文件预览用）：未识别语言转义为纯文本 */
export function highlightBlock(code: string, lang: string): string {
  if (!lang || !hljs.getLanguage(lang)) return escapeHtml(code);
  try {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}
