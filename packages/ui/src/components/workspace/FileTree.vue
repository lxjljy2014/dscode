<script setup lang="ts">
import { ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useSessionStore } from '../../stores/session';
import type { FileNode } from '@dscode/shared';

const { t } = useI18n();
const store = useSessionStore();
const { fileTree, selectedFile, selectedFilePath } = storeToRefs(store);

const opened = ref<string[]>([]);

function onActivate(ids: unknown) {
  const path = Array.isArray(ids) ? (ids[0] as string | undefined) : undefined;
  if (path) store.selectFile(path);
}

function isDir(node: FileNode) {
  return node.type === 'dir';
}
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- 文件树 -->
    <div class="shrink-0 overflow-y-auto border-b border-line p-2" :class="selectedFile ? 'max-h-[42%]' : 'flex-1'">
      <VTreeview
        v-model:opened="opened"
        :items="fileTree"
        item-title="name"
        item-value="path"
        :activated="selectedFilePath ? [selectedFilePath] : []"
        activatable
        density="compact"
        open-on-click
        @update:activated="onActivate"
      >
        <template #prepend="{ item }">
          <span class="text-3.5 text-muted" :class="isDir(item) ? 'i-lucide:folder' : 'i-lucide:file-text'" />
        </template>
      </VTreeview>
    </div>

    <!-- 文件内容 -->
    <div class="min-h-0 flex-1 overflow-auto">
      <template v-if="selectedFile">
        <div class="sticky top-0 flex items-center gap-2 border-b border-line bg-elevated px-3 py-1.5">
          <span class="i-lucide:file-text shrink-0 text-3.5 text-muted" />
          <span class="truncate font-mono text-xs text-fg">{{ selectedFile.path }}</span>
        </div>
        <pre class="p-3 font-mono text-xs leading-[22px] text-fg"><code>{{ selectedFile.content }}</code></pre>
      </template>

      <div v-else class="h-full flex flex-col items-center justify-center gap-2 text-faint">
        <span class="i-lucide:file-search text-6" />
        <span class="text-xs">{{ t('diff.selectFile') }}</span>
      </div>
    </div>
  </div>
</template>
