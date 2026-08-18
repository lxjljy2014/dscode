<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { GitGraphRow } from '@dscode/shared';
import { host } from '../../bridge/host';
import { useSettingsStore } from '../../stores/settings';

/**
 * git 图谱弹窗：git log --graph 结构化表格（图/描述/日期/作者/提交id）。
 * 打开时按当前工作目录加载。
 */

const model = defineModel<boolean>({ default: false });
const { t } = useI18n();
const settingsStore = useSettingsStore();

const loading = ref(false);
const error = ref('');
const rows = ref<GitGraphRow[]>([]);

// 图列对齐宽度：最长的图谱前缀（含纯线条行），至少 8 列
const graphPad = computed(() => {
  let max = 8;
  for (const r of rows.value) if (r.graph.length > max) max = r.graph.length;
  return max;
});

watch(model, async open => {
  if (!open || !host) return;
  loading.value = true;
  error.value = '';
  rows.value = [];
  try {
    const cwd = settingsStore.settings.workingDirectory;
    if (!cwd) {
      error.value = t('project.noProject');
      return;
    }
    const r = await host.gitGraph(cwd);
    if (r.ok) rows.value = r.graph;
    else error.value = r.error;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <VDialog v-model="model" max-width="800" scrollable>
    <VCard class="rounded-16px">
      <VCardTitle>{{ t('dialog.graphTitle') }}</VCardTitle>
      <VCardText class="p-0">
        <VProgressCircular v-if="loading" indeterminate class="ma-4" />
        <VTable v-else-if="rows.length > 0" density="compact" hover fixed-header height="40vh" class="graph-table">
          <thead>
            <tr>
              <th class="font-medium whitespace-nowrap text-faint">{{ t('dialog.graphColumns.graph') }}</th>
              <th class="font-medium text-faint">{{ t('dialog.graphColumns.description') }}</th>
              <th class="font-medium whitespace-nowrap text-faint">{{ t('dialog.graphColumns.date') }}</th>
              <th class="font-medium whitespace-nowrap text-faint">{{ t('dialog.graphColumns.author') }}</th>
              <th class="font-medium whitespace-nowrap text-faint">{{ t('dialog.graphColumns.hash') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in rows" :key="i">
              <td class="font-mono text-xs whitespace-pre">{{ row.graph.padEnd(graphPad) }}</td>
              <td class="break-words">{{ row.subject }}</td>
              <td class="whitespace-nowrap text-muted">{{ row.date }}</td>
              <td class="whitespace-nowrap text-muted">{{ row.author }}</td>
              <td class="font-mono text-xs text-muted">{{ row.hash }}</td>
            </tr>
          </tbody>
        </VTable>
        <p v-else-if="error" class="m-0 p-4 text-sm text-diff-del">{{ error }}</p>
        <p v-else-if="!loading" class="m-0 p-4 text-sm text-faint">{{ t('dialog.graphEmpty') }}</p>
      </VCardText>
      <VCardActions>
        <VSpacer />
        <VBtn :text="t('dialog.close')" @click="model = false" />
      </VCardActions>
    </VCard>
  </VDialog>
</template>
