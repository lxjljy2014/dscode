<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useWorkspaceStore } from '../../stores/workspace';
import { host } from '../../bridge/host';
import { highlightBlock, langFromPath } from '../../utils/highlight';
import type { FileNode } from '@dscode/shared';

const { t } = useI18n();
const store = useWorkspaceStore();
const { fileTree, selectedFile, selectedFilePath } = storeToRefs(store);

const opened = ref<string[]>([]);

// 大文件内容显示封顶，避免把整个 512KB 文本塞进一个 <pre> 造成卡顿
const MAX_CONTENT_CHARS = 100_000;
const displayedContent = computed(() => {
  const c = selectedFile.value?.content ?? '';
  return c.length > MAX_CONTENT_CHARS ? c.slice(0, MAX_CONTENT_CHARS) + '\n' + t('diff.fileTruncated') : c;
});
// 预览语法高亮（按扩展名；未识别语言退化为纯文本）
const highlightedPreview = computed(() => {
  const path = selectedFile.value?.path ?? '';
  return highlightBlock(displayedContent.value, langFromPath(path));
});

function onActivate(ids: unknown) {
  const path = Array.isArray(ids) ? (ids[0] as string | undefined) : undefined;
  if (path) store.selectFile(path);
}

function isDir(node: FileNode) {
  return node.type === 'dir';
}

// ---- 右键菜单与文件操作（新建文件/新建文件夹/重命名/删除） ----

/** 右键命中的节点（供菜单项计算目标路径） */
const contextNode = ref<FileNode | null>(null);
const contextMenu = ref(false);
const contextPos = ref({ x: 0, y: 0 });

function onContextMenu(e: MouseEvent, node: FileNode) {
  e.preventDefault();
  contextNode.value = node;
  contextPos.value = { x: e.clientX, y: e.clientY };
  contextMenu.value = true;
}

/** 操作的基准目录：文件取父目录、目录取自身（新建文件/文件夹用） */
function baseDirOf(node: FileNode): string {
  if (node.type === 'dir') return node.path;
  return parentOf(node.path);
}

/** 路径的父目录（根级返回空串） */
function parentOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx > 0 ? path.slice(0, idx) : '';
}

function joinPath(base: string, name: string): string {
  return base ? `${base}/${name}` : name;
}

// ---- 创建/重命名对话框（三操作共用：kind 区分标题与提交动作） ----

type DialogKind = 'create-file' | 'create-dir' | 'rename';
const dialogKind = ref<DialogKind | null>(null);
const nameInput = ref('');
const submitting = ref(false);
/** 重命名时的原路径 */
const renameFrom = ref('');

function openDialog(kind: DialogKind, node: FileNode) {
  dialogKind.value = kind;
  nameInput.value = kind === 'rename' ? node.name : '';
  renameFrom.value = node.path;
}

const dialogTitle = computed(() => {
  if (dialogKind.value === 'create-file') return t('fileTree.createFileTitle');
  if (dialogKind.value === 'create-dir') return t('fileTree.createDirTitle');
  return t('fileTree.renameTitle');
});

async function submitDialog() {
  if (!dialogKind.value || !contextNode.value || !host) return;
  const name = nameInput.value.trim();
  if (!name) return;
  submitting.value = true;
  try {
    let r: { ok: boolean; error?: string } = { ok: false };
    const node = contextNode.value;
    if (dialogKind.value === 'create-file') {
      r = await host.workspaceCreateFile(joinPath(baseDirOf(node), name));
    } else if (dialogKind.value === 'create-dir') {
      r = await host.workspaceCreateDir(joinPath(baseDirOf(node), name));
    } else {
      // 重命名：基准目录取原路径的父目录（目录自身也如此，避免移入自身内部）
      r = await host.workspaceRename(renameFrom.value, joinPath(parentOf(renameFrom.value), name));
    }
    if (r.ok) {
      notify(t(dialogKind.value === 'rename' ? 'fileTree.renamed' : 'fileTree.created'));
      dialogKind.value = null;
      await store.loadTree();
    } else {
      notify(r.error ?? t('fileTree.operationFailed'));
    }
  } finally {
    submitting.value = false;
  }
}

// ---- 删除确认对话框 ----

const deleteDialog = ref(false);
const deleting = ref(false);
const deleteTarget = ref<FileNode | null>(null);
function askDelete(node: FileNode) {
  deleteTarget.value = node;
  deleteDialog.value = true;
}
async function doDelete() {
  if (!deleteTarget.value || !host) return;
  deleting.value = true;
  const r = await host.workspaceDelete(deleteTarget.value.path);
  deleting.value = false;
  if (r.ok) {
    deleteDialog.value = false;
    // 若删的是当前选中文件，清空选中态
    if (selectedFilePath.value === deleteTarget.value.path) selectedFilePath.value = null;
    notify(t('fileTree.deleted'));
    await store.loadTree();
  } else {
    notify(r.error ?? t('fileTree.operationFailed'));
  }
}

// ---- 操作反馈 ----

const feedback = ref('');
const feedbackShow = ref(false);
function notify(text: string) {
  feedback.value = text;
  feedbackShow.value = true;
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
        <template #title="{ item }">
          <span
            class="block w-full cursor-context-menu select-none truncate"
            @contextmenu.prevent="onContextMenu($event, item)"
          >
            {{ item.name }}
          </span>
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
        <!-- eslint-disable-next-line vue/no-v-html -- hljs 输出已完成 HTML 转义 -->
        <pre class="p-3 font-mono text-xs leading-[22px] text-fg"><code v-html="highlightedPreview"></code></pre>
      </template>

      <div v-else class="h-full flex flex-col items-center justify-center gap-2 text-faint">
        <span class="i-lucide:file-search text-6" />
        <span class="text-xs">{{ t('diff.selectFile') }}</span>
      </div>
    </div>

    <!-- 右键菜单 -->
    <VMenu
      v-model="contextMenu"
      :style="{ left: contextPos.x + 'px', top: contextPos.y + 'px' }"
      absolute
    >
      <VList density="compact">
        <VListItem :title="t('fileTree.newFile')" prepend-icon="i-lucide:file-plus-2" @click="openDialog('create-file', contextNode!)" />
        <VListItem :title="t('fileTree.newFolder')" prepend-icon="i-lucide:folder-plus" @click="openDialog('create-dir', contextNode!)" />
        <VListItem :title="t('fileTree.rename')" prepend-icon="i-lucide:pencil" @click="openDialog('rename', contextNode!)" />
        <VDivider />
        <VListItem :title="t('fileTree.delete')" prepend-icon="i-lucide:trash-2" class="text-error" @click="askDelete(contextNode!)" />
      </VList>
    </VMenu>

    <!-- 新建/重命名对话框 -->
    <VDialog :model-value="dialogKind !== null" max-width="420" persistent @update:model-value="v => { if (!v) dialogKind = null }">
      <VCard>
        <VCardTitle class="text-sm">
          {{ dialogTitle }}
        </VCardTitle>
        <VCardText>
          <VTextField
            v-model="nameInput"
            density="compact"
            variant="outlined"
            :placeholder="t('fileTree.namePlaceholder')"
            autofocus
            @keydown.enter="submitDialog"
          />
        </VCardText>
        <VCardActions>
          <VSpacer />
          <VBtn variant="text" size="small" @click="dialogKind = null">
            {{ t('dialog.cancel') }}
          </VBtn>
          <VBtn color="primary" variant="flat" size="small" :disabled="!nameInput.trim() || submitting" :loading="submitting" @click="submitDialog">
            {{ dialogKind === 'rename' ? t('fileTree.rename') : t('fileTree.create') }}
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>

    <!-- 删除确认 -->
    <VDialog v-model="deleteDialog" max-width="420">
      <VCard>
        <VCardTitle class="text-sm">
          {{ t('fileTree.deleteConfirmTitle', { name: deleteTarget?.name ?? '' }) }}
        </VCardTitle>
        <VCardText class="text-xs leading-5 text-muted">
          {{ t('fileTree.deleteConfirmBody') }}
        </VCardText>
        <VCardActions>
          <VSpacer />
          <VBtn variant="text" size="small" @click="deleteDialog = false">
            {{ t('dialog.cancel') }}
          </VBtn>
          <VBtn color="error" variant="flat" size="small" :loading="deleting" @click="doDelete">
            {{ t('fileTree.delete') }}
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
