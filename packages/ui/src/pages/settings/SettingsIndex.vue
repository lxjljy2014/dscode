<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { IndexSearchHit, IndexStats } from '@dscode/shared';
import { host } from '../../bridge/host';

const { t } = useI18n();
const stats = ref<IndexStats>({ fileCount: 0, termCount: 0, builtAt: 0 });
const building = ref(false);
const query = ref('');
const hits = ref<IndexSearchHit[]>([]);
const searching = ref(false);

async function loadStats() {
  if (!host) return;
  try {
    stats.value = await host.indexStats();
  } catch {
    // 传输级异常：保持默认空态
  }
}

async function rebuild() {
  if (!host) return;
  building.value = true;
  try {
    stats.value = await host.indexBuild();
  } catch {
    // 传输级异常：保持现状
  } finally {
    building.value = false;
  }
}

async function search() {
  if (!host || !query.value.trim()) return;
  searching.value = true;
  try {
    hits.value = await host.indexSearch(query.value.trim());
  } catch {
    // 传输级异常：保持现状
  } finally {
    searching.value = false;
  }
}

onMounted(loadStats);
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="grid grid-cols-3 gap-4">
      <VCard class="px-4 py-3.5">
        <div class="text-xs text-muted">{{ t('settingsPage.index.files') }}</div>
        <div class="mt-1 text-xl font-semibold">{{ stats.fileCount }}</div>
      </VCard>
      <VCard class="px-4 py-3.5">
        <div class="text-xs text-muted">{{ t('settingsPage.index.terms') }}</div>
        <div class="mt-1 text-xl font-semibold">{{ stats.termCount }}</div>
      </VCard>
      <VCard class="px-4 py-3.5">
        <div class="text-xs text-muted">{{ t('settingsPage.index.builtAt') }}</div>
        <div class="mt-1 text-sm font-semibold">
          {{ stats.builtAt ? new Date(stats.builtAt).toLocaleString() : t('settingsPage.index.never') }}
        </div>
      </VCard>
    </div>

    <VCard class="px-4 py-3.5">
      <div class="flex items-center justify-between">
        <div class="text-sm font-medium">{{ t('settingsPage.index.search') }}</div>
        <VBtn size="small" color="primary" :loading="building" @click="rebuild">
          {{ t('settingsPage.index.rebuild') }}
        </VBtn>
      </div>
      <div class="mt-2 flex items-center gap-2">
        <VTextField
          v-model="query"
          density="compact" variant="outlined"
          hide-details
          :placeholder="t('settingsPage.index.searchPlaceholder')"
          class="flex-1"
          @keydown.enter="search"
        />
        <VBtn size="small" variant="outlined" :loading="searching" @click="search">
          {{ t('settingsPage.index.searchBtn') }}
        </VBtn>
      </div>
      <div v-if="hits.length" class="mt-3 flex flex-col">
        <div
          v-for="h in hits"
          :key="h.path"
          class="flex items-center justify-between border-b border-line py-1.5 last:border-b-0"
        >
          <code class="truncate font-mono text-sm">{{ h.path }}</code>
          <span class="shrink-0 text-xs text-muted">{{ h.score }}</span>
        </div>
      </div>
    </VCard>
  </div>
</template>
