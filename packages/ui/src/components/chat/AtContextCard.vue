<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useWorkspaceStore } from '../../stores/workspace';
import type { FileNode } from '@dscode/shared';

/**
 * @ 上下文卡片：输入框上方弹出的文件浏览器，列出当前工作空间的目录与文件。
 * 空关键字 = 逐级浏览目录；非空关键字 = 递归搜索文件。鼠标点击选择，Esc/Enter 由父级关闭。
 */

const props = defineProps<{ keyword: string }>();
const emit = defineEmits<{ select: [path: string] }>();

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const { fileTree } = storeToRefs(workspaceStore);

/** 当前浏览目录（相对工作目录，'' = 根） */
const currentDir = ref('');

interface Entry {
  path: string;
  name: string;
  type: 'file' | 'dir' | 'up';
}

/** 递归拍平文件树（记录每个节点的父目录） */
const flatNodes = computed(() => {
  const result: { node: FileNode; parent: string }[] = [];
  const walk = (nodes: FileNode[], parent: string) => {
    for (const n of nodes) {
      result.push({ node: n, parent });
      if (n.type === 'dir' && n.children) walk(n.children, n.path);
    }
  };
  walk(fileTree.value, '');
  return result;
});

/** 反斜杠（Windows 路径分隔符），用 charCode 规避源码转义 */
const BACKSLASH = String.fromCharCode(92);

/** 取父目录（兼容 / 与 \ 两种分隔符，保留原分隔符不变） */
function parentOf(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf(BACKSLASH));
  return i < 0 ? '' : path.slice(0, i);
}

/** 常见扩展名 → 主题强调色 key（对齐 ToolEventCard 的 toolAccent 色板） */
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

function extOf(path: string): string {
  const i = path.lastIndexOf('.');
  return i < 0 ? '' : path.slice(i + 1).toLowerCase();
}

/** 扩展名 → 强调色 key（未知扩展名按哈希稳定落色） */
function extColorKey(path: string): string {
  const ext = extOf(path);
  const key = EXT_COLORS[ext];
  if (key) return key;
  if (!ext) return 'tool-read';
  let h = 0;
  for (const ch of ext) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return ACCENT_KEYS[Math.abs(h) % ACCENT_KEYS.length] ?? 'tool-read';
}

/** 文件图标（按扩展名） */
function fileIcon(path: string): string {
  return EXT_ICONS[extOf(path)] ?? 'i-lucide:file';
}

/** 当前可见条目：搜索模式（文件）或浏览模式（目录 + 文件 + 上级） */
const entries = computed<Entry[]>(() => {
  const kw = props.keyword.trim().toLowerCase();
  if (kw) {
    return flatNodes.value
      .filter(
        f =>
          f.node.type === 'file' &&
          (f.node.name.toLowerCase().includes(kw) || f.node.path.toLowerCase().includes(kw))
      )
      .map(f => ({ path: f.node.path, name: f.node.name, type: 'file' as const }));
  }
  const result: Entry[] = [];
  if (currentDir.value) result.push({ path: parentOf(currentDir.value), name: '..', type: 'up' });
  const children = flatNodes.value.filter(f => f.parent === currentDir.value);
  children.sort((a, b) =>
    a.node.type === b.node.type ? a.node.name.localeCompare(b.node.name) : a.node.type === 'dir' ? -1 : 1
  );
  for (const c of children) result.push({ path: c.node.path, name: c.node.name, type: c.node.type });
  return result;
});

function onClick(entry: Entry): void {
  if (entry.type === 'file') emit('select', entry.path);
  else currentDir.value = entry.path;
}

function iconOf(entry: Entry): string {
  if (entry.type === 'up') return 'i-lucide:corner-left-up';
  if (entry.type === 'dir') return 'i-lucide:folder';
  return fileIcon(entry.path);
}

/** 目录暖色 / 文件按类型取色 / 上级灰色 */
function colorOf(entry: Entry): string {
  if (entry.type === 'dir') return 'rgb(var(--v-theme-tool-search))';
  if (entry.type === 'up') return 'rgba(var(--v-theme-on-surface), 0.6)';
  return 'rgb(var(--v-theme-' + extColorKey(entry.path) + '))';
}
</script>

<template>
  <div class="absolute bottom-full left-0 right-0 z-10 mb-2">
    <VCard rounded="2xl" class="border border-line bg-surface" elevation="8">
      <div v-if="entries.length" class="max-h-64 overflow-y-auto px-1 py-1">
        <VList nav density="compact">
          <VListItem v-for="e in entries" :key="e.path" rounded="lg" @click="onClick(e)">
            <template #prepend>
              <span class="text-3.5" :class="iconOf(e)" :style="{ color: colorOf(e) }" />
            </template>
            <VListItemTitle class="text-sm">
              <span class="flex items-center gap-2">
                <span class="min-w-0 flex-1 truncate font-mono">{{ e.name }}</span>
                <span v-if="e.type === 'file'" class="shrink-0 font-mono text-[11px] text-faint">{{ e.path }}</span>
              </span>
            </VListItemTitle>
          </VListItem>
        </VList>
      </div>
      <div v-else class="px-4 py-3 text-xs text-faint">{{ t('input.atEmpty') }}</div>
    </VCard>
  </div>
</template>
