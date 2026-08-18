/**
 * 文件类型 → 强调色/图标 的单一事实源（ToolEventCard 与 AtContextCard 共用，避免两处映射漂移）。
 * 色板 key 对应 theme/tokens.ts 的 toolAccent（tool-read/tool-list/...），未知扩展名按哈希稳定落色。
 */

/** 常见扩展名 → 主题强调色 key（合并自 ToolEventCard / AtContextCard 历史映射，取并集） */
const EXT_COLORS: Record<string, string> = {
  ts: 'tool-read', tsx: 'tool-read', mts: 'tool-read', cts: 'tool-read',
  js: 'tool-search', jsx: 'tool-search', mjs: 'tool-search', cjs: 'tool-search',
  vue: 'tool-write', py: 'tool-write',
  md: 'tool-run',
  json: 'tool-edit', sh: 'tool-edit', bash: 'tool-edit', zsh: 'tool-edit',
  css: 'tool-browse', scss: 'tool-browse', less: 'tool-browse',
  html: 'tool-list', xml: 'tool-list', yaml: 'tool-list', yml: 'tool-list', toml: 'tool-list', ini: 'tool-list'
};

/** 常见扩展名 → 图标（Lucide file-* 系列） */
const EXT_ICONS: Record<string, string> = {
  ts: 'i-lucide:file-code-2', tsx: 'i-lucide:file-code-2', mts: 'i-lucide:file-code-2', cts: 'i-lucide:file-code-2',
  js: 'i-lucide:file-code', jsx: 'i-lucide:file-code', mjs: 'i-lucide:file-code', cjs: 'i-lucide:file-code',
  vue: 'i-lucide:file-code-2', py: 'i-lucide:file-code',
  json: 'i-lucide:file-json',
  md: 'i-lucide:file-text',
  css: 'i-lucide:palette', scss: 'i-lucide:palette', less: 'i-lucide:palette',
  html: 'i-lucide:file-code', xml: 'i-lucide:file-code',
  sh: 'i-lucide:terminal', bash: 'i-lucide:terminal', zsh: 'i-lucide:terminal',
  yaml: 'i-lucide:settings', yml: 'i-lucide:settings', toml: 'i-lucide:settings', ini: 'i-lucide:settings',
  png: 'i-lucide:file-image', jpg: 'i-lucide:file-image', jpeg: 'i-lucide:file-image',
  gif: 'i-lucide:file-image', webp: 'i-lucide:file-image', svg: 'i-lucide:file-image'
};

const ACCENT_KEYS = ['tool-read', 'tool-list', 'tool-search', 'tool-run', 'tool-write', 'tool-edit', 'tool-browse'];

/** 取路径末段扩展名（小写；无扩展名返回空串） */
export function extOf(path: string): string {
  const i = path.lastIndexOf('.');
  return i < 0 ? '' : path.slice(i + 1).toLowerCase();
}

/** 扩展名 → 强调色 key（未知扩展名按哈希稳定落色，无扩展名回退 tool-read） */
export function accentKeyForExt(ext: string): string {
  const key = EXT_COLORS[ext];
  if (key) return key;
  if (!ext) return 'tool-read';
  let h = 0;
  for (const ch of ext) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return ACCENT_KEYS[Math.abs(h) % ACCENT_KEYS.length] ?? 'tool-read';
}

/** 路径 → 强调色 key（按扩展名） */
export function accentKeyForPath(path: string): string {
  return accentKeyForExt(extOf(path));
}

/** 路径 → 文件图标（按扩展名；未知回退通用文件图标） */
export function iconForPath(path: string): string {
  return EXT_ICONS[extOf(path)] ?? 'i-lucide:file';
}
