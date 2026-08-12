<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useSessionStore } from '../stores/session'
import FileTree from './FileTree.vue'

const { t } = useI18n()
const store = useSessionStore()
const { diffFiles } = storeToRefs(store)

const tab = defineModel<'changes' | 'files'>({ default: 'changes' })
</script>

<template>
  <div class="h-full flex flex-col bg-surface">
    <VTabs v-model="tab" class="shrink-0 border-b border-line" slider-color="primary">
      <VTab value="changes" class="text-sm">
        <span class="i-lucide:file-diff mr-1.5 text-3.5" />
        {{ t('diff.changes') }}
      </VTab>
      <VTab value="files" class="text-sm">
        <span class="i-lucide:folder-tree mr-1.5 text-3.5" />
        {{ t('diff.files') }}
      </VTab>
    </VTabs>

    <VTabsWindow v-model="tab" class="min-h-0 flex-1">
      <!-- 变更 -->
      <VTabsWindowItem value="changes" class="h-full">
        <div v-if="diffFiles.length" class="h-full overflow-y-auto">
          <div v-for="f in diffFiles" :key="f.path" class="border-b border-line">
            <div
              class="sticky top-0 z-1 flex items-center gap-2 border-b border-line bg-elevated px-3 py-1.5"
            >
              <span class="i-lucide:file-diff shrink-0 text-3.5 text-muted" />
              <span class="truncate font-mono text-xs text-fg">{{ f.path }}</span>
              <span class="ml-auto shrink-0 font-mono text-xs text-diff-add">
                {{ t('diff.additions', { n: f.additions }) }}
              </span>
              <span class="shrink-0 font-mono text-xs text-diff-del">
                {{ t('diff.deletions', { n: f.deletions }) }}
              </span>
            </div>

            <div class="py-1 font-mono text-xs leading-[22px]">
              <template v-for="(line, i) in f.lines" :key="i">
                <!-- hunk 头 -->
                <div v-if="line.type === 'hunk'" class="px-3 text-faint select-none">
                  {{ line.content }}
                </div>
                <!-- 普通行 -->
                <div
                  v-else
                  class="flex"
                  :class="{
                    'bg-diff-add/12': line.type === 'add',
                    'bg-diff-del/12': line.type === 'del'
                  }"
                >
                  <span class="w-9 shrink-0 select-none pr-2 text-right text-faint">
                    {{ line.oldLineNo ?? '' }}
                  </span>
                  <span class="w-9 shrink-0 select-none pr-2 text-right text-faint">
                    {{ line.newLineNo ?? '' }}
                  </span>
                  <span
                    class="w-4 shrink-0 select-none text-center"
                    :class="{
                      'text-diff-add': line.type === 'add',
                      'text-diff-del': line.type === 'del',
                      'text-faint': line.type === 'context'
                    }"
                  >
                    {{ line.type === 'add' ? '+' : line.type === 'del' ? '-' : '' }}
                  </span>
                  <span class="whitespace-pre-wrap pr-3 text-fg">{{ line.content }}</span>
                </div>
              </template>
            </div>
          </div>
        </div>

        <div v-else class="h-full flex flex-col items-center justify-center gap-2 text-faint">
          <span class="i-lucide:file-check-2 text-6" />
          <span class="text-xs">{{ t('diff.emptyChanges') }}</span>
        </div>
      </VTabsWindowItem>

      <!-- 文件 -->
      <VTabsWindowItem value="files" class="h-full">
        <FileTree />
      </VTabsWindowItem>
    </VTabsWindow>
  </div>
</template>
