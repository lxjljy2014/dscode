<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import type { DiffFile, DiffLine } from '@dscode/shared';
import { useAgentStore } from '../../stores/agent';
import { highlightLine, langFromPath } from '../../utils/highlight';
import FileTree from './FileTree.vue';

const { t } = useI18n();
const store = useAgentStore();
const { diffFiles, generating } = storeToRefs(store);

const tab = defineModel<'changes' | 'files'>({ default: 'changes' });

// 大 diff 防护：文件数 / 单文件行数封顶，避免海量 DOM 导致卡顿
const MAX_DIFF_FILES = 200;
const MAX_DIFF_LINES = 2000;
const visibleDiffFiles = computed(() => diffFiles.value.slice(0, MAX_DIFF_FILES));
const hiddenFileCount = computed(() => Math.max(0, diffFiles.value.length - MAX_DIFF_FILES));
function visibleLines(f: DiffFile) {
  return f.lines.slice(0, MAX_DIFF_LINES);
}
function hiddenLineCount(f: DiffFile) {
  return Math.max(0, f.lines.length - MAX_DIFF_LINES);
}

// ---- 视图切换（统一 / 并排）与行级语法高亮 ----

const viewMode = ref<'unified' | 'split'>('unified');

/** 统一视图：每个文件的高亮行 HTML（computed 缓存，避免每次渲染重跑 hljs） */
const unifiedHtml = computed(() => {
  const map = new Map<string, string[]>();
  for (const f of visibleDiffFiles.value) {
    const lang = langFromPath(f.path);
    map.set(
      f.path,
      visibleLines(f).map(l => (l.type === 'hunk' ? l.content : highlightLine(l.content, lang)))
    );
  }
  return map;
});

/** 并排视图行：左列旧内容（del+context）、右列新内容（add+context），hunk 跨两列 */
interface SplitRow {
  hunk?: string;
  left?: DiffLine;
  right?: DiffLine;
  leftHtml: string;
  rightHtml: string;
}

/**
 * 统一 diff 行序列 → 并排行对：连续的 del 块与紧随的 add 块按序配对（GitHub 式对齐），
 * 短的一侧留空；context 行左右同现。
 */
function toSplitRows(f: DiffFile): SplitRow[] {
  const lang = langFromPath(f.path);
  const lines = visibleLines(f);
  const rows: SplitRow[] = [];
  let i = 0;
  const make = (left?: DiffLine, right?: DiffLine, hunk?: string): SplitRow => ({
    left,
    right,
    hunk,
    leftHtml: left && left.type !== 'hunk' ? highlightLine(left.content, lang) : '',
    rightHtml: right && right.type !== 'hunk' ? highlightLine(right.content, lang) : ''
  });
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.type === 'hunk') {
      rows.push(make(undefined, undefined, line.content));
      i++;
      continue;
    }
    if (line.type === 'context') {
      rows.push(make(line, line));
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i]!.type === 'del') dels.push(lines[i++]!);
    while (i < lines.length && lines[i]!.type === 'add') adds.push(lines[i++]!);
    const pairs = Math.max(dels.length, adds.length);
    for (let k = 0; k < pairs; k++) rows.push(make(dels[k], adds[k]));
  }
  return rows;
}

const splitRows = computed(() => {
  const map = new Map<string, SplitRow[]>();
  for (const f of visibleDiffFiles.value) map.set(f.path, toSplitRows(f));
  return map;
});

// ---- 回滚 / 提交 ----

/** 操作反馈（snackbar） */
const feedback = ref('');
const feedbackShow = ref(false);
function notify(text: string) {
  feedback.value = text;
  feedbackShow.value = true;
}

/** 回滚确认对话框 */
const restoreDialog = ref(false);
const restoring = ref(false);
async function doRestore() {
  restoring.value = true;
  const r = await store.restoreWorkspace();
  restoring.value = false;
  if (r.ok) {
    restoreDialog.value = false;
    notify(t('diff.restoreDone', { n: r.restored ?? 0 }));
  } else {
    // 运行中/无快照给定向文案，其余透出主进程原始错误
    const key = r.error === 'running' ? 'diff.restoreRunning' : r.error === 'no-snapshot' ? 'diff.restoreNoSnapshot' : null;
    notify(key ? t(key) : (r.error ?? t('diff.restoreFailed')));
  }
}

/** 提交对话框（可勾选文件，未勾选的改动保留在工作区） */
const commitDialog = ref(false);
const commitMessage = ref('');
const committing = ref(false);
const commitSelected = ref<string[]>([]);
// 打开对话框时默认全选
watch(commitDialog, open => {
  if (open) commitSelected.value = diffFiles.value.map(f => f.path);
});
const commitAllSelected = computed(() => commitSelected.value.length === diffFiles.value.length);
function toggleAllCommit() {
  commitSelected.value = commitAllSelected.value ? [] : diffFiles.value.map(f => f.path);
}
const commitDisabled = computed(
  () => commitMessage.value.trim().length === 0 || commitSelected.value.length === 0 || committing.value
);
async function doCommit() {
  committing.value = true;
  const r = await store.commitChanges(commitMessage.value.trim(), [...commitSelected.value]);
  committing.value = false;
  if (r.ok) {
    commitDialog.value = false;
    commitMessage.value = '';
    notify(t('diff.commitDone'));
  } else {
    notify(r.error ?? t('diff.commitFailed'));
  }
}
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

    <!-- 变更工具条：文件数 + 视图切换 + 提交/回滚入口（仅变更页且有 diff 时展示） -->
    <div
      v-if="tab === 'changes' && diffFiles.length"
      class="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-1"
    >
      <span class="truncate text-xs text-muted">
        {{ t('diff.fileCount', { n: diffFiles.length }) }}
      </span>
      <div class="flex shrink-0 items-center gap-1">
        <VBtnToggle v-model="viewMode" mandatory density="compact" class="mr-1">
          <VBtn value="unified" size="x-small" :title="t('diff.viewUnified')">
            <span class="i-lucide:rows-3 text-3.5" />
          </VBtn>
          <VBtn value="split" size="x-small" :title="t('diff.viewSplit')">
            <span class="i-lucide:columns-2 text-3.5" />
          </VBtn>
        </VBtnToggle>
        <VBtn size="x-small" variant="text" class="text-xs" :disabled="generating" @click="commitDialog = true">
          <span class="i-lucide:git-commit-horizontal mr-1 text-3.5" />
          {{ t('diff.commit') }}
        </VBtn>
        <VBtn size="x-small" variant="text" class="text-xs" :disabled="generating" @click="restoreDialog = true">
          <span class="i-lucide:undo-2 mr-1 text-3.5" />
          {{ t('diff.restore') }}
        </VBtn>
      </div>
    </div>

    <VTabsWindow v-model="tab" class="min-h-0 flex-1">
      <!-- 变更 -->
      <VTabsWindowItem value="changes" class="h-full">
        <div v-if="diffFiles.length" class="h-full overflow-y-auto">
          <div v-for="f in visibleDiffFiles" :key="f.path" class="border-b border-line">
            <div class="sticky top-0 z-1 flex items-center gap-2 border-b border-line bg-elevated px-3 py-1.5">
              <span class="i-lucide:file-diff shrink-0 text-3.5 text-muted" />
              <span class="truncate font-mono text-xs text-fg">{{ f.path }}</span>
              <span
                v-if="f.status"
                class="shrink-0 rounded px-1 text-[10px]"
                :class="f.status === 'new' ? 'bg-diff-add/12 text-diff-add' : 'bg-diff-del/12 text-diff-del'"
              >
                {{ f.status === 'new' ? t('diff.newFile') : t('diff.deletedFile') }}
              </span>
              <span class="ml-auto shrink-0 font-mono text-xs text-diff-add">
                {{ t('diff.additions', { n: f.additions }) }}
              </span>
              <span class="shrink-0 font-mono text-xs text-diff-del">
                {{ t('diff.deletions', { n: f.deletions }) }}
              </span>
            </div>

            <!-- 统一视图 -->
            <div v-if="viewMode === 'unified'" class="py-1 font-mono text-xs leading-[22px]">
              <template v-for="(line, i) in visibleLines(f)" :key="i">
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
                  <!-- eslint-disable-next-line vue/no-v-html -- hljs 输出已完成 HTML 转义 -->
                  <span class="whitespace-pre-wrap pr-3 text-fg" v-html="unifiedHtml.get(f.path)?.[i]"></span>
                </div>
              </template>
              <div v-if="hiddenLineCount(f) > 0" class="px-3 text-faint select-none">
                {{ t('diff.foldedLines', { n: hiddenLineCount(f) }) }}
              </div>
            </div>

            <!-- 并排视图：左旧右新，del/add 块按序配对 -->
            <div v-else class="py-1 font-mono text-xs leading-[22px]">
              <template v-for="(row, i) in splitRows.get(f.path) ?? []" :key="i">
                <div v-if="row.hunk" class="px-3 text-faint select-none">
                  {{ row.hunk }}
                </div>
                <div v-else class="flex">
                  <!-- 左列（旧） -->
                  <div
                    class="flex w-1/2 min-w-0"
                    :class="{ 'bg-diff-del/12': row.left?.type === 'del' }"
                  >
                    <span class="w-9 shrink-0 select-none pr-2 text-right text-faint">
                      {{ row.left?.oldLineNo ?? '' }}
                    </span>
                    <span
                      class="w-4 shrink-0 select-none text-center"
                      :class="row.left?.type === 'del' ? 'text-diff-del' : 'text-faint'"
                    >
                      {{ row.left?.type === 'del' ? '-' : '' }}
                    </span>
                    <!-- eslint-disable-next-line vue/no-v-html -- hljs 输出已完成 HTML 转义 -->
                    <span class="min-w-0 flex-1 whitespace-pre-wrap pr-2 text-fg" v-html="row.leftHtml"></span>
                  </div>
                  <!-- 右列（新） -->
                  <div
                    class="flex w-1/2 min-w-0 border-l border-line"
                    :class="{ 'bg-diff-add/12': row.right?.type === 'add' }"
                  >
                    <span class="w-9 shrink-0 select-none pr-2 text-right text-faint">
                      {{ row.right?.newLineNo ?? '' }}
                    </span>
                    <span
                      class="w-4 shrink-0 select-none text-center"
                      :class="row.right?.type === 'add' ? 'text-diff-add' : 'text-faint'"
                    >
                      {{ row.right?.type === 'add' ? '+' : '' }}
                    </span>
                    <!-- eslint-disable-next-line vue/no-v-html -- hljs 输出已完成 HTML 转义 -->
                    <span class="min-w-0 flex-1 whitespace-pre-wrap pr-2 text-fg" v-html="row.rightHtml"></span>
                  </div>
                </div>
              </template>
              <div v-if="hiddenLineCount(f) > 0" class="px-3 text-faint select-none">
                {{ t('diff.foldedLines', { n: hiddenLineCount(f) }) }}
              </div>
            </div>
          </div>
          <div v-if="hiddenFileCount > 0" class="px-3 py-2 text-xs text-faint">
            {{ t('diff.foldedFiles', { n: hiddenFileCount }) }}
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

    <!-- 回滚确认 -->
    <VDialog v-model="restoreDialog" max-width="420">
      <VCard>
        <VCardTitle class="text-sm">
          {{ t('diff.restoreConfirmTitle') }}
        </VCardTitle>
        <VCardText class="text-xs leading-5 text-muted">
          {{ t('diff.restoreConfirmBody', { n: diffFiles.length }) }}
        </VCardText>
        <VCardActions>
          <VSpacer />
          <VBtn variant="text" size="small" @click="restoreDialog = false">
            {{ t('dialog.cancel') }}
          </VBtn>
          <VBtn color="error" variant="flat" size="small" :loading="restoring" @click="doRestore">
            {{ t('diff.restore') }}
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>

    <!-- 提交 -->
    <VDialog v-model="commitDialog" max-width="520">
      <VCard>
        <VCardTitle class="text-sm">
          {{ t('diff.commitTitle', { n: commitSelected.length }) }}
        </VCardTitle>
        <VCardText>
          <VTextField
            v-model="commitMessage"
            density="compact"
            variant="outlined"
            :placeholder="t('diff.commitPlaceholder')"
            autofocus
            class="mb-2"
          />
          <div class="mb-1 flex items-center justify-between">
            <span class="text-xs text-muted">{{ t('diff.commitSelectFiles') }}</span>
            <VBtn size="x-small" variant="text" class="text-xs" @click="toggleAllCommit">
              {{ commitAllSelected ? t('diff.deselectAll') : t('diff.selectAll') }}
            </VBtn>
          </div>
          <div class="max-h-48 overflow-y-auto rounded border border-line px-2 py-1">
            <VCheckbox
              v-for="f in diffFiles"
              :key="f.path"
              v-model="commitSelected"
              :value="f.path"
              density="compact"
              hide-details
            >
              <template #label>
                <span class="truncate font-mono text-xs text-fg">{{ f.path }}</span>
              </template>
            </VCheckbox>
          </div>
        </VCardText>
        <VCardActions>
          <VSpacer />
          <VBtn variant="text" size="small" @click="commitDialog = false">
            {{ t('dialog.cancel') }}
          </VBtn>
          <VBtn color="primary" variant="flat" size="small" :disabled="commitDisabled" :loading="committing" @click="doCommit">
            {{ t('diff.commit') }}
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>

    <!-- 操作反馈 -->
    <VSnackbar v-model="feedbackShow" :timeout="2600" location="top">
      {{ feedback }}
    </VSnackbar>
  </div>
</template>
