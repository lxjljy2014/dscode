import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { FileNode } from '@dscode/shared';
import { host } from '../bridge/host';
import { useSettingsStore } from './settings';

/**
 * 工作区域 store：文件树 / 文件内容缓存 / 选中文件。
 * 自 session store 拆出，职责收敛到「工作区文件浏览」。
 */
export const useWorkspaceStore = defineStore('workspace', () => {
  const fileTree = ref<FileNode[]>([]);
  const selectedFilePath = ref<string | null>(null);
  /** 已加载的文件内容缓存（path → content） */
  const fileContents = ref<Record<string, string>>({});

  /** 文件树扁平索引（path → node）：selectedFile 从 O(n) 递归降为 O(1) 查表 */
  const nodeIndex = computed(() => {
    const map = new Map<string, FileNode>();
    const walk = (nodes: FileNode[]): void => {
      for (const n of nodes) {
        map.set(n.path, n);
        if (n.children) walk(n.children);
      }
    };
    walk(fileTree.value);
    return map;
  });

  const selectedFile = computed(() => {
    if (!selectedFilePath.value) return null;
    const node = nodeIndex.value.get(selectedFilePath.value);
    if (!node || node.type !== 'file') return null;
    return { ...node, content: fileContents.value[node.path] ?? '' };
  });

  async function selectFile(path: string) {
    selectedFilePath.value = path;
    if (!host) return;
    const r = await host.workspaceReadFile(path);
    // 用户已切到别的文件：丢弃过期响应，避免覆盖当前选中显示
    if (selectedFilePath.value !== path) return;
    fileContents.value[path] = r.ok ? r.content : `（读取失败：${r.error}）`;
  }

  async function loadTree(): Promise<void> {
    if (!host) return;
    // 工作目录切换：清空旧工作区的文件内容缓存与选中态，避免无界增长/残留脏高亮
    fileContents.value = {};
    selectedFilePath.value = null;
    fileTree.value = await host.workspaceTree();
  }

  // 工作目录变化：刷新文件树
  if (host) {
    watch(
      () => useSettingsStore().settings.workingDirectory,
      () => void loadTree()
    );
  }

  void loadTree();

  return { fileTree, selectedFilePath, fileContents, selectedFile, selectFile, loadTree };
});
